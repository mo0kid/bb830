import { useMemo } from 'react';
import { useCircuitStore } from '../stores/circuit-store';
import { useUIStore } from '../stores/ui-store';
import { COMPONENT_LIBRARY } from '../panels/ComponentLibrary';
import type { Component, Net } from '../../shared/netlist-types';
import type { Board, Placement } from '../../shared/board-types';

/** What a dangling pin connects to */
export type PinTerminal =
  | { type: 'vcc' }
  | { type: 'gnd' }
  | { type: 'input'; label: string }
  | { type: 'output'; label: string }
  | { type: 'unconnected' };

export interface DerivedData {
  nets: Net[];
  /** Map of "componentId:pinIndex" → what it terminates to */
  terminals: Map<string, PinTerminal>;
}

/** Derive nets and terminal info from breadboard bus connections */
function deriveFromBoard(board: Board, components: Component[]): DerivedData {
  // Bus map: "row:side" → component pins on that bus
  const busMap = new Map<string, Array<{ componentId: string; pinIndex: number }>>();
  // Rail map: "row:side" → which rail wires connect to it
  const railConnections = new Map<string, 'vcc' | 'gnd'>();

  function addToBus(row: number, col: string, componentId: string, pinIndex: number) {
    const ci = 'abcdefghij'.indexOf(col);
    if (ci < 0) return;
    const side = ci < 5 ? 'left' : 'right';
    const key = `${row}:${side}`;
    if (!busMap.has(key)) busMap.set(key, []);
    const bus = busMap.get(key)!;
    if (!bus.some(e => e.componentId === componentId && e.pinIndex === pinIndex)) {
      bus.push({ componentId, pinIndex });
    }
  }

  function getBusKey(row: number, col: string): string | null {
    const ci = 'abcdefghij'.indexOf(col);
    if (ci < 0) return null;
    return `${row}:${ci < 5 ? 'left' : 'right'}`;
  }

  // Analyze wires for rail connections
  for (const wire of board.wires) {
    const from = wire.from as { row: number; col: string };
    const to = wire.to as { row: number; col: string };

    // Check if either end is a rail
    const isFromRail = from.col.includes('+') || from.col.includes('-');
    const isToRail = to.col.includes('+') || to.col.includes('-');

    if (isFromRail && !isToRail) {
      const rail = from.col.includes('+') ? 'vcc' : 'gnd';
      const busKey = getBusKey(to.row, to.col);
      if (busKey) railConnections.set(busKey, rail);
    } else if (isToRail && !isFromRail) {
      const rail = to.col.includes('+') ? 'vcc' : 'gnd';
      const busKey = getBusKey(from.row, from.col);
      if (busKey) railConnections.set(busKey, rail);
    }
  }

  // Map component pins to buses
  for (const placement of board.placements) {
    const comp = components.find(c => c.id === placement.componentId);
    if (!comp) continue;

    if (comp.package.startsWith('DIP')) {
      const pps = comp.pins.length / 2;
      for (let i = 0; i < pps; i++) {
        addToBus(placement.pin1Position.row + i, 'e', comp.id, i);
        addToBus(placement.pin1Position.row + i, 'f', comp.id, comp.pins.length - 1 - i);
      }
    } else if (comp.type === 'transistor') {
      addToBus(placement.pin1Position.row - 1, placement.pin1Position.col, comp.id, 1);
      addToBus(placement.pin1Position.row, placement.pin1Position.col, comp.id, 0);
      addToBus(placement.pin1Position.row + 1, placement.pin1Position.col, comp.id, 2);
    } else {
      addToBus(placement.pin1Position.row, placement.pin1Position.col, comp.id, 0);
      if (placement.pin2Position) {
        addToBus(placement.pin2Position.row, placement.pin2Position.col, comp.id, 1);
      }
    }
  }

  // Build nets
  const nets: Net[] = [];
  for (const [busKey, entries] of busMap) {
    if (entries.length < 2) continue;
    nets.push({ id: `bus-${busKey}`, name: `bus_${busKey.replace(':', '_')}`, connections: entries });
  }

  // Build terminal map — for each component pin, determine what it terminates to
  const terminals = new Map<string, PinTerminal>();

  for (const placement of board.placements) {
    const comp = components.find(c => c.id === placement.componentId);
    if (!comp || comp.package.startsWith('DIP')) continue;

    // Check each pin of the passive
    const pinPositions: Array<{ pinIndex: number; row: number; col: string }> = [];
    pinPositions.push({ pinIndex: 0, row: placement.pin1Position.row, col: placement.pin1Position.col });
    if (placement.pin2Position) {
      pinPositions.push({ pinIndex: 1, row: placement.pin2Position.row, col: placement.pin2Position.col });
    }

    for (const { pinIndex, row, col } of pinPositions) {
      const key = `${comp.id}:${pinIndex}`;
      const busKey = getBusKey(row, col);

      // Check if this bus connects to a rail
      if (busKey && railConnections.has(busKey)) {
        terminals.set(key, { type: railConnections.get(busKey)! });
        continue;
      }

      // Check if this bus connects to an IC pin (already in a net)
      if (busKey && busMap.has(busKey)) {
        const bus = busMap.get(busKey)!;
        const hasIC = bus.some(e => {
          const c = components.find(cc => cc.id === e.componentId);
          return c && c.package.startsWith('DIP');
        });
        if (hasIC) continue; // Connected to IC — net handles it
      }

      // Check if this bus connects to another passive
      if (busKey && busMap.has(busKey) && busMap.get(busKey)!.length >= 2) {
        continue; // Connected to another component
      }

      // Dangling — determine label from context
      const isOutput = comp.type === 'resistor' && (comp.label?.includes('4') || comp.label?.includes('5') || comp.label?.includes('6') || comp.label?.includes('7'));
      if (isOutput) {
        // Output resistors — their free ends are signal outputs
        const icNet = nets.find(n => n.connections.some(c => c.componentId === comp.id));
        const icConn = icNet?.connections.find(c => {
          const cc = components.find(ccc => ccc.id === c.componentId);
          return cc?.package.startsWith('DIP');
        });
        if (icConn) {
          const ic = components.find(c => c.id === icConn.componentId);
          const pinName = ic?.pins[icConn.pinIndex]?.name ?? 'OUT';
          terminals.set(key, { type: 'output', label: pinName });
          continue;
        }
      }

      // Default: unconnected input
      terminals.set(key, { type: 'input', label: comp.label ?? comp.type });
    }
  }

  return { nets, terminals };
}

/**
 * SchematicView — proper signal-flow schematic with orthogonal routing,
 * T-junction connections, and crossover pass-throughs.
 */

const GRID = 20; // Base grid unit
const IC_W = 10 * GRID;
const PIN_SPACING = 2 * GRID;
const WIRE_COLOR = '#888';
const NET_COLORS = ['#e94560', '#3366ff', '#2ecc71', '#cc8833', '#ff8800', '#44aaaa', '#cc44cc', '#aaaa33'];

const CAT_COLORS: Record<string, string> = {
  vco: '#e94560', vcf: '#3366ff', vca: '#2ecc71', opamp: '#aaaaaa',
  transistor: '#cc8833', diode: '#ff8800', resistor: '#d4a574',
  capacitor: '#6699cc', potentiometer: '#999999',
};

function formatValue(comp: Component): string {
  const p = comp.parameters;
  if (comp.type === 'resistor') {
    const r = p['resistance'];
    if (!r) return '';
    if (r >= 1e6) return `${(r / 1e6).toFixed(r % 1e6 === 0 ? 0 : 1)}M`;
    if (r >= 1e3) return `${(r / 1e3).toFixed(r % 1e3 === 0 ? 0 : 1)}k`;
    return `${r}\u03A9`;
  }
  if (comp.type === 'capacitor') {
    const c = p['capacitance'];
    if (!c) return '';
    if (c >= 1e-6) return `${(c * 1e6).toFixed(c * 1e6 >= 10 ? 0 : 1)}\u00B5`;
    if (c >= 1e-9) return `${(c * 1e9).toFixed(0)}n`;
    return `${(c * 1e12).toFixed(0)}p`;
  }
  if (comp.type === 'potentiometer') {
    const r = p['resistance'];
    if (r >= 1e3) return `${(r / 1e3).toFixed(0)}k`;
    return `${r}\u03A9`;
  }
  if (comp.type === 'diode') return `${p['vForward'] ?? 0.6}V`;
  return '';
}

// ---- Schematic symbol drawing functions ----

function drawResistor(x1: number, y1: number, x2: number, y2: number, label: string, value: string, selected: boolean) {
  const isVert = x1 === x2;
  const color = selected ? '#00ff88' : '#d4a574';
  const elems: React.JSX.Element[] = [];

  if (isVert) {
    const midY = (y1 + y2) / 2;
    const bodyH = Math.min(Math.abs(y2 - y1) * 0.5, 30);
    const top = midY - bodyH / 2;
    // Lead lines
    elems.push(<line key="l1" x1={x1} y1={y1} x2={x1} y2={top} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="l2" x1={x1} y1={midY + bodyH / 2} x2={x1} y2={y2} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    // Zigzag body
    const segs = 5;
    const segH = bodyH / segs;
    const amp = 5;
    let d = `M${x1},${top}`;
    for (let i = 0; i < segs; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      d += ` L${x1 + dir * amp},${top + (i + 0.5) * segH}`;
    }
    d += ` L${x1},${top + bodyH}`;
    elems.push(<path key="body" d={d} fill="none" stroke={color} strokeWidth={2} />);
    // Labels
    elems.push(<text key="lbl" x={x1 + 12} y={midY - 4} fill="#aaa" fontSize={9} fontFamily="monospace" fontWeight="bold">{label}</text>);
    elems.push(<text key="val" x={x1 + 12} y={midY + 10} fill="#777" fontSize={8} fontFamily="monospace">{value}</text>);
  } else {
    const midX = (x1 + x2) / 2;
    const bodyW = Math.min(Math.abs(x2 - x1) * 0.5, 30);
    const left = midX - bodyW / 2;
    elems.push(<line key="l1" x1={x1} y1={y1} x2={left} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="l2" x1={midX + bodyW / 2} y1={y1} x2={x2} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    const segs = 5;
    const segW = bodyW / segs;
    const amp = 5;
    let d = `M${left},${y1}`;
    for (let i = 0; i < segs; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      d += ` L${left + (i + 0.5) * segW},${y1 + dir * amp}`;
    }
    d += ` L${left + bodyW},${y1}`;
    elems.push(<path key="body" d={d} fill="none" stroke={color} strokeWidth={2} />);
    elems.push(<text key="lbl" x={midX} y={y1 - 8} fill="#aaa" fontSize={9} fontFamily="monospace" fontWeight="bold" textAnchor="middle">{label}</text>);
    elems.push(<text key="val" x={midX} y={y1 + 16} fill="#777" fontSize={8} fontFamily="monospace" textAnchor="middle">{value}</text>);
  }
  return elems;
}

function drawCapacitor(x1: number, y1: number, x2: number, y2: number, label: string, value: string, selected: boolean) {
  const isVert = x1 === x2;
  const color = selected ? '#00ff88' : '#6699cc';
  const elems: React.JSX.Element[] = [];
  const gap = 4;
  const plateH = 8;

  if (isVert) {
    const midY = (y1 + y2) / 2;
    elems.push(<line key="l1" x1={x1} y1={y1} x2={x1} y2={midY - gap} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="l2" x1={x1} y1={midY + gap} x2={x1} y2={y2} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="p1" x1={x1 - plateH} y1={midY - gap} x2={x1 + plateH} y2={midY - gap} stroke={color} strokeWidth={2.5} />);
    elems.push(<line key="p2" x1={x1 - plateH} y1={midY + gap} x2={x1 + plateH} y2={midY + gap} stroke={color} strokeWidth={2.5} />);
    elems.push(<text key="lbl" x={x1 + 14} y={midY - 4} fill="#aaa" fontSize={9} fontFamily="monospace" fontWeight="bold">{label}</text>);
    elems.push(<text key="val" x={x1 + 14} y={midY + 10} fill="#777" fontSize={8} fontFamily="monospace">{value}</text>);
  } else {
    const midX = (x1 + x2) / 2;
    elems.push(<line key="l1" x1={x1} y1={y1} x2={midX - gap} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="l2" x1={midX + gap} y1={y1} x2={x2} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />);
    elems.push(<line key="p1" x1={midX - gap} y1={y1 - plateH} x2={midX - gap} y2={y1 + plateH} stroke={color} strokeWidth={2.5} />);
    elems.push(<line key="p2" x1={midX + gap} y1={y1 - plateH} x2={midX + gap} y2={y1 + plateH} stroke={color} strokeWidth={2.5} />);
    elems.push(<text key="lbl" x={midX} y={y1 - 12} fill="#aaa" fontSize={9} fontFamily="monospace" fontWeight="bold" textAnchor="middle">{label}</text>);
    elems.push(<text key="val" x={midX} y={y1 + 18} fill="#777" fontSize={8} fontFamily="monospace" textAnchor="middle">{value}</text>);
  }
  return elems;
}

function drawDiode(x1: number, y1: number, x2: number, y2: number, label: string, selected: boolean) {
  const color = selected ? '#00ff88' : '#ff8800';
  const midX = (x1 + x2) / 2;
  const sz = 7;
  return [
    <line key="l1" x1={x1} y1={y1} x2={midX - sz} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />,
    <polygon key="tri" points={`${midX - sz},${y1 - sz} ${midX - sz},${y1 + sz} ${midX + sz},${y1}`} fill="none" stroke={color} strokeWidth={2} />,
    <line key="bar" x1={midX + sz} y1={y1 - sz} x2={midX + sz} y2={y1 + sz} stroke={color} strokeWidth={2} />,
    <line key="l2" x1={midX + sz} y1={y1} x2={x2} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />,
    <text key="lbl" x={midX} y={y1 - 12} fill="#aaa" fontSize={9} fontFamily="monospace" fontWeight="bold" textAnchor="middle">{label}</text>,
  ];
}

// ---- IC Block ----
function ICSymbol({ x, y, comp, selected, onSelect }: {
  x: number; y: number;
  comp: Component;
  selected: boolean;
  onSelect: () => void;
}) {
  const def = COMPONENT_LIBRARY.find(c => c.type === comp.type);
  const category = def?.category ?? 'opamp';
  const color = CAT_COLORS[category] ?? '#888';
  const pinsPerSide = Math.ceil(comp.pins.length / 2);
  const blockH = pinsPerSide * PIN_SPACING + GRID;
  const sc = selected ? '#00ff88' : color;

  return (
    <g onClick={onSelect} style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={IC_W} height={blockH} rx={3} fill="#1a1a2e" stroke={sc} strokeWidth={selected ? 2.5 : 1.5} />
      <path d={`M${x + IC_W / 2 - 6},${y} A6,6 0 0,1 ${x + IC_W / 2 + 6},${y}`} fill="#111" stroke={sc} strokeWidth={1} />
      <text x={x + IC_W / 2} y={y + 16} fill={color} fontSize={12} fontFamily="monospace" fontWeight="bold" textAnchor="middle">{comp.type}</text>
      <text x={x + IC_W / 2} y={y + 28} fill="#666" fontSize={10} fontFamily="monospace" textAnchor="middle">{comp.label}</text>

      {comp.pins.slice(0, pinsPerSide).map((pin, i) => {
        const py = y + GRID + 20 + i * PIN_SPACING;
        return (
          <g key={`l${pin.index}`}>
            <line x1={x - GRID} y1={py} x2={x} y2={py} stroke="#555" strokeWidth={1.5} />
            <circle cx={x - GRID} cy={py} r={2} fill="#555" />
            <text x={x + 4} y={py + 3} fill="#777" fontSize={7} fontFamily="monospace">{pin.index + 1} {pin.name}</text>
          </g>
        );
      })}

      {comp.pins.slice(pinsPerSide).map((pin, i) => {
        const py = y + GRID + 20 + (pinsPerSide - 1 - i) * PIN_SPACING;
        return (
          <g key={`r${pin.index}`}>
            <line x1={x + IC_W} y1={py} x2={x + IC_W + GRID} y2={py} stroke="#555" strokeWidth={1.5} />
            <circle cx={x + IC_W + GRID} cy={py} r={2} fill="#555" />
            <text x={x + IC_W - 4} y={py + 3} fill="#777" fontSize={7} fontFamily="monospace" textAnchor="end">{pin.name} {pin.index + 1}</text>
          </g>
        );
      })}
    </g>
  );
}

// ---- Junction dot (T-connection) ----
function Junction({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={3} fill="#e94560" />;
}

// ---- Terminal symbols for dangling passive ends ----
function TerminalSymbol({ x, y, terminal, side }: { x: number; y: number; terminal: PinTerminal; side: 'left' | 'right' }) {
  const dx = side === 'left' ? -1 : 1;
  const tx = x + dx * GRID * 1.5;

  if (terminal.type === 'vcc') {
    // V+ power symbol: upward arrow with line
    return (
      <g>
        <line x1={x} y1={y} x2={tx} y2={y} stroke="#cc2222" strokeWidth={1.5} />
        <line x1={tx} y1={y} x2={tx} y2={y - 12} stroke="#cc2222" strokeWidth={2} />
        <line x1={tx - 6} y1={y - 8} x2={tx} y2={y - 14} stroke="#cc2222" strokeWidth={2} />
        <line x1={tx + 6} y1={y - 8} x2={tx} y2={y - 14} stroke="#cc2222" strokeWidth={2} />
        <text x={tx} y={y - 16} fill="#cc2222" fontSize={8} fontFamily="monospace" textAnchor="middle">V+</text>
      </g>
    );
  }

  if (terminal.type === 'gnd') {
    // GND symbol: 3 horizontal lines
    return (
      <g>
        <line x1={x} y1={y} x2={tx} y2={y} stroke="#2244bb" strokeWidth={1.5} />
        <line x1={tx} y1={y} x2={tx} y2={y + 4} stroke="#2244bb" strokeWidth={2} />
        <line x1={tx - 8} y1={y + 6} x2={tx + 8} y2={y + 6} stroke="#2244bb" strokeWidth={2} />
        <line x1={tx - 5} y1={y + 10} x2={tx + 5} y2={y + 10} stroke="#2244bb" strokeWidth={1.5} />
        <line x1={tx - 2} y1={y + 14} x2={tx + 2} y2={y + 14} stroke="#2244bb" strokeWidth={1} />
      </g>
    );
  }

  if (terminal.type === 'output') {
    // Output arrow with label
    return (
      <g>
        <line x1={x} y1={y} x2={tx + dx * 10} y2={y} stroke="#2ecc71" strokeWidth={1.5} />
        <polygon
          points={`${tx + dx * 10},${y - 5} ${tx + dx * 10},${y + 5} ${tx + dx * 20},${y}`}
          fill="#2ecc71" opacity={0.8}
        />
        <text
          x={tx + dx * 24} y={y + 4}
          fill="#2ecc71" fontSize={8} fontFamily="monospace"
          textAnchor={side === 'left' ? 'end' : 'start'}
        >
          {terminal.label}
        </text>
      </g>
    );
  }

  if (terminal.type === 'input') {
    // Input connector with label
    return (
      <g>
        <line x1={x} y1={y} x2={tx} y2={y} stroke="#e94560" strokeWidth={1.5} />
        <circle cx={tx + dx * 4} cy={y} r={4} fill="none" stroke="#e94560" strokeWidth={1.5} />
        <text
          x={tx + dx * 12} y={y + 4}
          fill="#e94560" fontSize={8} fontFamily="monospace"
          textAnchor={side === 'left' ? 'end' : 'start'}
        >
          {terminal.label}
        </text>
      </g>
    );
  }

  // Unconnected — small X
  return (
    <g>
      <line x1={x - 3} y1={y - 3} x2={x + 3} y2={y + 3} stroke="#666" strokeWidth={1} />
      <line x1={x - 3} y1={y + 3} x2={x + 3} y2={y - 3} stroke="#666" strokeWidth={1} />
    </g>
  );
}

export function SchematicView() {
  const { project } = useCircuitStore();
  const { selectItem, selectedItemId } = useUIStore();
  const components = project.netlist.components;
  const board = project.boards[0];

  // Auto-derive nets and terminal info from breadboard bus connections
  const derived = useMemo(() => {
    if (!board) return { nets: [] as Net[], terminals: new Map<string, PinTerminal>() };
    return deriveFromBoard(board, components);
  }, [board, components]);
  const nets = derived.nets;
  const terminals = derived.terminals;

  const layout = useMemo(() => {
    const ics = components.filter(c => c.package.startsWith('DIP'));
    const passives = components.filter(c => !c.package.startsWith('DIP'));

    // Position ICs vertically centered
    const IC_X = 18 * GRID;
    let icY = 3 * GRID;
    const icPos: Array<{ comp: Component; x: number; y: number; h: number }> = [];
    for (const ic of ics) {
      const pps = Math.ceil(ic.pins.length / 2);
      const h = pps * PIN_SPACING + GRID;
      icPos.push({ comp: ic, x: IC_X, y: icY, h });
      icY += h + 3 * GRID;
    }

    // Build pin position map
    const pinXY = new Map<string, { x: number; y: number }>();
    for (const { comp, x, y } of icPos) {
      const pps = Math.ceil(comp.pins.length / 2);
      for (let i = 0; i < pps; i++) {
        pinXY.set(`${comp.id}:${i}`, { x: x - GRID, y: y + GRID + 20 + i * PIN_SPACING });
      }
      for (let i = pps; i < comp.pins.length; i++) {
        const di = comp.pins.length - 1 - i;
        pinXY.set(`${comp.id}:${i}`, { x: x + IC_W + GRID, y: y + GRID + 20 + di * PIN_SPACING });
      }
    }

    // Position passives inline with their connections
    // Group passives by which IC pin they connect to
    const passiveLayout: Array<{
      comp: Component; x1: number; y1: number; x2: number; y2: number;
      orientation: 'h' | 'v';
    }> = [];

    for (const p of passives) {
      // Find which net(s) this passive is in
      const myNets = nets.filter(n => n.connections.some(c => c.componentId === p.id));
      let placed = false;

      for (const net of myNets) {
        // Find which pin of the passive is in this net
        const passiveConn = net.connections.find(c => c.componentId === p.id);
        if (!passiveConn) continue;
        const passivePinInNet = passiveConn.pinIndex; // 0 or 1

        // Find the IC pin this net also connects to
        for (const conn of net.connections) {
          if (conn.componentId === p.id) continue;
          const icPin = pinXY.get(`${conn.componentId}:${conn.pinIndex}`);
          if (!icPin) continue;

          const icEntry = icPos.find(ic => ic.comp.id === conn.componentId);
          if (!icEntry) continue;

          const isLeft = icPin.x < icEntry.x + IC_W / 2;
          const passiveLen = 3 * GRID;
          const gap = 3 * GRID;

          // The passive pin that connects to the IC goes nearest the IC
          // The other pin goes on the outside
          const icSidePin = passivePinInNet;      // this pin faces the IC
          const outerPin = 1 - passivePinInNet;    // this pin faces outward

          if (isLeft) {
            const x2 = icPin.x - gap;              // IC side
            const x1 = x2 - passiveLen;             // outer side
            passiveLayout.push({ comp: p, x1, y1: icPin.y, x2, y2: icPin.y, orientation: 'h' });
            pinXY.set(`${p.id}:${icSidePin}`, { x: x2, y: icPin.y });
            pinXY.set(`${p.id}:${outerPin}`, { x: x1, y: icPin.y });
          } else {
            const x1 = icPin.x + gap;              // IC side
            const x2 = x1 + passiveLen;             // outer side
            passiveLayout.push({ comp: p, x1, y1: icPin.y, x2, y2: icPin.y, orientation: 'h' });
            pinXY.set(`${p.id}:${icSidePin}`, { x: x1, y: icPin.y });
            pinXY.set(`${p.id}:${outerPin}`, { x: x2, y: icPin.y });
          }
          placed = true;
          break;
        }
        if (placed) break;
      }

      // Fallback: place below ICs, spread out vertically
      if (!placed) {
        const fallbackIdx = passiveLayout.length;
        const col = fallbackIdx % 3;
        const row = Math.floor(fallbackIdx / 3);
        const fx = 4 * GRID + col * 8 * GRID;
        const fy = icY + 2 * GRID + row * 2.5 * GRID;
        passiveLayout.push({ comp: p, x1: fx, y1: fy, x2: fx + 3 * GRID, y2: fy, orientation: 'h' });
        pinXY.set(`${p.id}:0`, { x: fx, y: fy });
        pinXY.set(`${p.id}:1`, { x: fx + 3 * GRID, y: fy });
      }
    }

    const maxPassiveY = passiveLayout.reduce((max, p) => Math.max(max, p.y1, p.y2), 0);
    return { ics, passives, icPos, passiveLayout, pinXY, totalH: Math.max(icY, maxPassiveY) + 6 * GRID };
  }, [components, nets]);

  if (components.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>Schematic View</div>
          <div style={styles.emptySub}>Place components on the board to see the schematic</div>
        </div>
      </div>
    );
  }

  const svgW = 70 * GRID;
  const svgH = Math.max(layout.totalH, 30 * GRID);

  return (
    <div style={styles.container}>
      <div style={styles.legend}>
        <span style={styles.legendTitle}>Schematic</span>
        <span style={styles.legendItem}>{layout.ics.length} ICs</span>
        <span style={styles.legendItem}>{layout.passives.length} passives</span>
        <span style={styles.legendItem}>{nets.length} nets</span>
      </div>

      <svg width={svgW} height={svgH} style={styles.svg}>
        <defs>
          <pattern id="sgrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={GRID / 2} cy={GRID / 2} r={1} fill="#222233" />
          </pattern>
        </defs>
        <rect width={svgW} height={svgH} fill="url(#sgrid)" />

        {/* Power rails */}
        <line x1={GRID} y1={GRID} x2={svgW - GRID} y2={GRID} stroke="#cc2222" strokeWidth={2} opacity={0.4} />
        <text x={GRID + 4} y={GRID - 4} fill="#cc2222" fontSize={9} fontFamily="monospace">V+</text>
        <line x1={GRID} y1={svgH - GRID} x2={svgW - GRID} y2={svgH - GRID} stroke="#2244bb" strokeWidth={2} opacity={0.4} />
        <text x={GRID + 4} y={svgH - GRID - 4} fill="#2244bb" fontSize={9} fontFamily="monospace">GND</text>

        {/* Net connections — channel-based orthogonal routing */}
        {(() => {
          // IC center and edges for routing decisions
          const icCenterX = layout.icPos.length > 0 ? layout.icPos[0].x + IC_W / 2 : svgW / 2;
          const icLeftEdge = layout.icPos.length > 0 ? Math.min(...layout.icPos.map(p => p.x)) : svgW / 2;
          const icRightEdge = layout.icPos.length > 0 ? Math.max(...layout.icPos.map(p => p.x + IC_W)) : svgW / 2;

          // Channel allocation: each side gets incrementally spaced vertical channels
          const CHANNEL_SPACING = 8;
          let leftChannelCount = 0;
          let rightChannelCount = 0;

          // Pre-process: figure out which nets need vertical routing and on which side
          type NetRoute = {
            ni: number;
            color: string;
            positions: Array<{ x: number; y: number }>;
            needsVertical: boolean;
            side: 'left' | 'right' | 'cross';
            channel: number; // allocated channel index
          };

          const netRoutes: NetRoute[] = [];

          for (let ni = 0; ni < nets.length; ni++) {
            const net = nets[ni];
            if (net.connections.length < 2) continue;
            const color = NET_COLORS[ni % NET_COLORS.length];

            const positions = net.connections
              .map(c => layout.pinXY.get(`${c.componentId}:${c.pinIndex}`))
              .filter(Boolean) as Array<{ x: number; y: number }>;

            if (positions.length < 2) continue;

            // Determine if pins are at different heights (need vertical routing)
            const ys = positions.map(p => p.y);
            const needsVertical = Math.max(...ys) - Math.min(...ys) > 2;

            // Determine side
            const allLeft = positions.every(p => p.x < icCenterX);
            const allRight = positions.every(p => p.x >= icCenterX);
            const side = allLeft ? 'left' : allRight ? 'right' : 'cross';

            // Allocate channel
            let channel = 0;
            if (needsVertical) {
              if (side === 'left') {
                channel = leftChannelCount++;
              } else if (side === 'right') {
                channel = rightChannelCount++;
              } else {
                // Cross-side: use right channels
                channel = rightChannelCount++;
              }
            }

            netRoutes.push({ ni, color, positions, needsVertical, side, channel });
          }

          // Passive component bounding boxes for avoidance
          const passiveBounds = layout.passiveLayout.map(p => ({
            left: Math.min(p.x1, p.x2) - 5,
            right: Math.max(p.x1, p.x2) + 5,
            top: Math.min(p.y1, p.y2) - 12,
            bottom: Math.max(p.y1, p.y2) + 12,
          }));

          return netRoutes.map(({ ni, color, positions, needsVertical, side, channel }) => {
            const wires: React.JSX.Element[] = [];

            // Group positions by Y (same-row connections are horizontal wires)
            const rowGroups = new Map<number, Array<{ x: number; y: number }>>();
            for (const pos of positions) {
              const roundedY = Math.round(pos.y / 4) * 4; // snap to ~4px grid
              if (!rowGroups.has(roundedY)) rowGroups.set(roundedY, []);
              rowGroups.get(roundedY)!.push(pos);
            }

            // 1) Draw horizontal wires within each row group
            let wireIdx = 0;
            const rowAnchors: Array<{ x: number; y: number }> = []; // one anchor per row for vertical routing
            for (const [, group] of rowGroups) {
              group.sort((a, b) => a.x - b.x);
              // Connect all positions in this row with a horizontal wire
              if (group.length >= 2) {
                const x1 = group[0].x;
                const x2 = group[group.length - 1].x;
                const y = group[0].y;
                wires.push(<line key={`h${ni}-${wireIdx++}`} x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={1.5} />);
              }
              // Pick the IC-side position as anchor for vertical routing
              const anchor = side === 'left'
                ? group.reduce((best, p) => p.x > best.x ? p : best, group[0])
                : group.reduce((best, p) => p.x < best.x ? p : best, group[0]);
              rowAnchors.push(anchor);
            }

            // 2) Draw vertical wires between row anchors
            rowAnchors.sort((a, b) => a.y - b.y);
            for (let i = 1; i < rowAnchors.length; i++) {
              const a = rowAnchors[i - 1];
              const b = rowAnchors[i];
              const dx = b.x - a.x;
              const dy = b.y - a.y;

              let d: string;

              if (Math.abs(dy) < 2) {
                d = `M${a.x},${a.y} L${b.x},${b.y}`;
              } else if (Math.abs(dx) < 2) {
                d = `M${a.x},${a.y} L${b.x},${b.y}`;
              } else if (Math.abs(dx) < GRID * 2) {
                d = `M${a.x},${a.y} L${a.x},${b.y} L${b.x},${b.y}`;
              } else if (side === 'left') {
                // Both on left — route via dedicated left channel
                // Channel X: progressively further left from the leftmost passive
                const channelX = icLeftEdge - GRID * 2 - (3 * GRID) - channel * CHANNEL_SPACING;
                d = `M${a.x},${a.y} L${channelX},${a.y} L${channelX},${b.y} L${b.x},${b.y}`;
              } else if (side === 'right') {
                // Both on right — route via dedicated right channel
                // But check if the vertical span crosses an IC body
                const channelX = icRightEdge + GRID * 2 + (3 * GRID) + channel * CHANNEL_SPACING;
                const minY = Math.min(a.y, b.y);
                const maxY = Math.max(a.y, b.y);
                const crossesIC = layout.icPos.some(ic => {
                  return channelX < ic.x + IC_W + GRID * 3 && minY < ic.y + ic.h && maxY > ic.y;
                });

                if (crossesIC && layout.icPos.length >= 2) {
                  // Route through gap between ICs instead
                  const sortedObs = layout.icPos.map(p => ({ top: p.y, bottom: p.y + p.h })).sort((x, y) => x.top - y.top);
                  let foundGap = false;
                  for (let g = 0; g < sortedObs.length - 1; g++) {
                    const gapTop = sortedObs[g].bottom;
                    const gapBot = sortedObs[g + 1].top;
                    if (gapBot - gapTop > GRID) {
                      const gapY = gapTop + (gapBot - gapTop) / 2;
                      // Route: down to gap, across to far right channel, down to target
                      const farX = channelX;
                      d = `M${a.x},${a.y} L${farX},${a.y} L${farX},${gapY} L${farX},${b.y} L${b.x},${b.y}`;
                      foundGap = true;
                      break;
                    }
                  }
                  if (!foundGap) {
                    d = `M${a.x},${a.y} L${channelX},${a.y} L${channelX},${b.y} L${b.x},${b.y}`;
                  }
                } else {
                  d = `M${a.x},${a.y} L${channelX},${a.y} L${channelX},${b.y} L${b.x},${b.y}`;
                }
              } else {
                // Cross-side — route between ICs if gap exists, else around right
                const sortedObs = layout.icPos.map(p => ({ top: p.y, bottom: p.y + p.h })).sort((a, b) => a.top - b.top);
                let routedThroughGap = false;

                for (let g = 0; g < sortedObs.length - 1; g++) {
                  const gapTop = sortedObs[g].bottom;
                  const gapBot = sortedObs[g + 1].top;
                  if (gapBot - gapTop > GRID * 2) {
                    const gapY = gapTop + (gapBot - gapTop) / 2 + channel * CHANNEL_SPACING;
                    const minY = Math.min(a.y, b.y);
                    const maxY = Math.max(a.y, b.y);
                    if (gapY > minY - GRID && gapY < maxY + GRID) {
                      d = `M${a.x},${a.y} L${a.x},${gapY} L${b.x},${gapY} L${b.x},${b.y}`;
                      routedThroughGap = true;
                      break;
                    }
                  }
                }

                if (!routedThroughGap) {
                  const channelX = icRightEdge + GRID * 2 + (3 * GRID) + channel * CHANNEL_SPACING;
                  d = `M${a.x},${a.y} L${channelX},${a.y} L${channelX},${b.y} L${b.x},${b.y}`;
                }

                d = d!;
              }

              wires.push(<path key={`w${ni}-${i}`} d={d!} fill="none" stroke={color} strokeWidth={1.5} />);
            }

            return (
              <g key={`net-${ni}`}>
                {wires}
                {positions.map((pos, i) => (
                  <Junction key={`j${ni}-${i}`} x={pos.x} y={pos.y} />
                ))}
              </g>
            );
          });
        })()}

        {/* IC symbols */}
        {layout.icPos.map(({ comp, x, y }) => (
          <ICSymbol
            key={comp.id} x={x} y={y} comp={comp}
            selected={selectedItemId === comp.id}
            onSelect={() => selectItem(comp.id, 'component')}
          />
        ))}

        {/* Passive symbols inline */}
        {layout.passiveLayout.map(({ comp, x1, y1, x2, y2 }) => {
          const selected = selectedItemId === comp.id;
          const value = formatValue(comp);

          // Get terminal info for both pins
          const term0 = terminals.get(`${comp.id}:0`);
          const term1 = terminals.get(`${comp.id}:1`);

          return (
            <g key={comp.id} onClick={() => selectItem(comp.id, 'component')} style={{ cursor: 'pointer' }}>
              {comp.type === 'resistor' && drawResistor(x1, y1, x2, y2, comp.label ?? '', value, selected)}
              {comp.type === 'capacitor' && drawCapacitor(x1, y1, x2, y2, comp.label ?? '', value, selected)}
              {comp.type === 'diode' && drawDiode(x1, y1, x2, y2, comp.label ?? '', selected)}
              {comp.type === 'potentiometer' && drawResistor(x1, y1, x2, y2, comp.label ?? '', value, selected)}

              {/* Terminal symbols at dangling ends */}
              {term0 && <TerminalSymbol x={x1} y={y1} terminal={term0} side="left" />}
              {term1 && <TerminalSymbol x={x2} y={y2} terminal={term1} side="right" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { width: '100%', height: '100%', overflow: 'auto', background: '#111', position: 'relative' },
  svg: { display: 'block', margin: '0 auto' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  emptyTitle: { fontSize: 24, fontWeight: 600, color: '#444' },
  emptySub: { fontSize: 14, marginTop: 8, color: '#333' },
  legend: { position: 'absolute', top: 8, right: 16, display: 'flex', gap: 16, alignItems: 'center', zIndex: 10 },
  legendTitle: { color: '#e94560', fontSize: 14, fontWeight: 700, fontFamily: 'monospace' },
  legendItem: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
};
