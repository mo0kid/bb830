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

    // Determine which pin connects to an IC (the "inner" pin)
    // and which is the "outer" pin that needs a terminal symbol
    let innerPinIdx = -1;
    let icPinName = '';

    for (const { pinIndex, row, col } of pinPositions) {
      const busKey = getBusKey(row, col);
      if (busKey && busMap.has(busKey)) {
        const bus = busMap.get(busKey)!;
        const icEntry = bus.find(e => {
          const c = components.find(cc => cc.id === e.componentId);
          return c && c.package.startsWith('DIP') && e.componentId !== comp.id;
        });
        if (icEntry) {
          innerPinIdx = pinIndex;
          const ic = components.find(c => c.id === icEntry.componentId);
          icPinName = ic?.pins[icEntry.pinIndex]?.name ?? '';
          break;
        }
      }
    }

    // Set terminals for each pin that isn't connected to an IC
    for (const { pinIndex, row, col } of pinPositions) {
      const key = `${comp.id}:${pinIndex}`;
      const busKey = getBusKey(row, col);

      // Skip the IC-connected pin — the horizontal wire handles it
      if (pinIndex === innerPinIdx) continue;

      // Check if this pin connects to a power rail
      if (busKey && railConnections.has(busKey)) {
        terminals.set(key, { type: railConnections.get(busKey)! });
        continue;
      }

      // This is the outer pin — label describes the SIGNAL, not the IC pin
      if (innerPinIdx >= 0) {
        const icPinUpper = icPinName.toUpperCase();

        // Map IC pin names to meaningful signal labels
        const signalLabels: Record<string, string> = {
          'RAMP OUT': 'SAW',
          'PULSE OUT': 'PULSE',
          'TRI OUT': 'TRI',
          'FREQ CV IN': '1V/OCT',
          'FREQ CV SUM': 'CV',
          'PW IN': 'PW',
          'HARD SYNC': 'SYNC',
          'SOFT SYNC': 'SYNC',
          'SCALE IN': 'SCALE',
          'SCALE TRIM': 'TRIM',
          'COMP IN': 'COMP',
          'TIMING RES': 'V+',
          'TIMING CAP': 'GND',
          'OUT A': 'SAW OUT',
          'OUT B': 'PULSE OUT',
          'IN A-': 'SAW IN',
          'IN A+': 'GND',
          'IN B-': 'PULSE IN',
          'IN B+': 'GND',
          'V+': 'V+',
          'V-': 'V-',
          'GND': 'GND',
        };

        const label = signalLabels[icPinName] ?? comp.label ?? icPinName;

        // Determine type from signal context
        if (label === 'V+') {
          terminals.set(key, { type: 'vcc' });
        } else if (label === 'GND' || label === 'V-') {
          terminals.set(key, { type: 'gnd' });
        } else if (icPinUpper.includes('OUT') || icPinUpper.includes('RAMP') || icPinUpper.includes('PULSE') || icPinUpper.includes('TRI')) {
          terminals.set(key, { type: 'output', label });
        } else {
          terminals.set(key, { type: 'input', label });
        }
      } else {
        terminals.set(key, { type: 'input', label: comp.label ?? comp.type });
      }
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

function drawDiode(x1: number, y1: number, x2: number, y2: number, label: string, selected: boolean, anodeX?: number) {
  const color = selected ? '#00ff88' : '#ff8800';
  const midX = (x1 + x2) / 2;
  const sz = 7;
  // Direction: triangle points from anode to cathode
  // If anodeX is provided, use it to determine direction; otherwise assume left-to-right
  const dir = anodeX !== undefined ? (anodeX < midX ? 1 : -1) : 1;
  return [
    <line key="l1" x1={x1} y1={y1} x2={midX - dir * sz} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />,
    <polygon key="tri" points={`${midX - dir * sz},${y1 - sz} ${midX - dir * sz},${y1 + sz} ${midX + dir * sz},${y1}`} fill="none" stroke={color} strokeWidth={2} />,
    <line key="bar" x1={midX + dir * sz} y1={y1 - sz} x2={midX + dir * sz} y2={y1 + sz} stroke={color} strokeWidth={2} />,
    <line key="l2" x1={midX + dir * sz} y1={y1} x2={x2} y2={y1} stroke={WIRE_COLOR} strokeWidth={1.5} />,
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
function TerminalSymbol({ x, y, terminal, side, vccCol, gndCol }: {
  x: number; y: number; terminal: PinTerminal; side: 'left' | 'right';
  vccCol: number; gndCol: number;
}) {
  const dx = side === 'left' ? -1 : 1;
  const gap = GRID * 1.5;

  if (terminal.type === 'vcc') {
    const tx = vccCol;
    return (
      <g>
        <line x1={x} y1={y} x2={tx} y2={y} stroke="#cc2222" strokeWidth={1.5} />
        <line x1={tx} y1={y} x2={tx} y2={y - 8} stroke="#cc2222" strokeWidth={2} />
        <line x1={tx - 6} y1={y - 4} x2={tx} y2={y - 10} stroke="#cc2222" strokeWidth={2} />
        <line x1={tx + 6} y1={y - 4} x2={tx} y2={y - 10} stroke="#cc2222" strokeWidth={2} />
        <text x={tx} y={y - 14} fill="#cc2222" fontSize={9} fontFamily="monospace" textAnchor="middle" fontWeight="bold">V+</text>
      </g>
    );
  }

  if (terminal.type === 'gnd') {
    const tx = gndCol;
    return (
      <g>
        <line x1={x} y1={y} x2={tx} y2={y} stroke="#2244bb" strokeWidth={1.5} />
        <line x1={tx} y1={y + 2} x2={tx} y2={y + 4} stroke="#2244bb" strokeWidth={2} />
        <line x1={tx - 8} y1={y + 6} x2={tx + 8} y2={y + 6} stroke="#2244bb" strokeWidth={2} />
        <line x1={tx - 5} y1={y + 10} x2={tx + 5} y2={y + 10} stroke="#2244bb" strokeWidth={1.5} />
        <line x1={tx - 2} y1={y + 14} x2={tx + 2} y2={y + 14} stroke="#2244bb" strokeWidth={1} />
      </g>
    );
  }

  // Signal color matching — paired signals share the same color
  const SIGNAL_COLORS: Record<string, string> = {
    'SAW': '#ff8844',     'SAW OUT': '#ff8844',    'SAW IN': '#ff8844',
    'PULSE': '#cc44cc',   'PULSE OUT': '#cc44cc',  'PULSE IN': '#cc44cc',
    'TRI': '#44cc44',     'TRI OUT': '#44cc44',    'TRI IN': '#44cc44',
    '1V/OCT': '#44aadd',  'CV': '#44aadd',
    'PW': '#ddaa44',
    'SYNC': '#dd4444',
    'SCALE': '#aa88cc',   'TRIM': '#aa88cc',
    'COMP': '#888888',
  };

  const label = (terminal.type === 'output' || terminal.type === 'input') ? terminal.label : '';
  const signalColor = SIGNAL_COLORS[label] ?? (terminal.type === 'output' ? '#2ecc71' : '#e94560');

  if (terminal.type === 'output') {
    // Output terminals between signal joins and V+/GND
    const ox = side === 'left' ? x - 5 * GRID : x + 5 * GRID;
    return (
      <g>
        <line x1={x} y1={y} x2={ox} y2={y} stroke={signalColor} strokeWidth={1.5} />
        <polygon
          points={`${ox},${y - 5} ${ox},${y + 5} ${ox + dx * 10},${y}`}
          fill={signalColor} opacity={0.8}
        />
        <text
          x={ox + dx * 14} y={y + 4}
          fill={signalColor} fontSize={9} fontFamily="monospace" fontWeight="bold"
          textAnchor={side === 'left' ? 'end' : 'start'}
        >
          {terminal.label}
        </text>
      </g>
    );
  }

  if (terminal.type === 'input') {
    // Input terminals between signal joins and V+/GND
    const ox = side === 'left' ? x - 5 * GRID : x + 5 * GRID;
    return (
      <g>
        <line x1={x} y1={y} x2={ox} y2={y} stroke={signalColor} strokeWidth={1.5} />
        <circle cx={ox + dx * 4} cy={y} r={4} fill="none" stroke={signalColor} strokeWidth={1.5} />
        <text
          x={ox + dx * 12} y={y + 4}
          fill={signalColor} fontSize={9} fontFamily="monospace" fontWeight="bold"
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
  const { project, currentBoardId } = useCircuitStore();
  const { selectItem, selectedItemId } = useUIStore();
  const board = project.boards.find(b => b.id === currentBoardId) ?? project.boards[0];

  // Only show components placed on the current board
  const boardComponentIds = useMemo(() => {
    if (!board) return new Set<string>();
    return new Set(board.placements.map(p => p.componentId));
  }, [board]);
  const components = useMemo(
    () => project.netlist.components.filter(c => boardComponentIds.has(c.id)),
    [project.netlist.components, boardComponentIds],
  );

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
      icY += h + 6 * GRID;
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

    // Helper to get bus key for a passive's pin from its placement
    function getBusKeyForComp(comp: Component, pinIdx: number): string | null {
      const placement = board?.placements.find(p => p.componentId === comp.id);
      if (!placement) return null;
      const pos = pinIdx === 0 ? placement.pin1Position : placement.pin2Position;
      if (!pos) return null;
      const ci = 'abcdefghij'.indexOf(pos.col);
      if (ci < 0) return null;
      return `${pos.row}:${ci < 5 ? 'left' : 'right'}`;
    }

    let fallbackPowerIdx = 0;

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

      // Fallback: power components go between IC blocks, others spread below
      if (!placed) {
        // Check if this is a power component (both pins connect to rails)
        const pin0Bus = getBusKeyForComp(p, 0);
        const pin1Bus = getBusKeyForComp(p, 1);
        const pin0Rail = pin0Bus ? derived.terminals.get(`${p.id}:0`) : null;
        const pin1Rail = pin1Bus ? derived.terminals.get(`${p.id}:1`) : null;
        const isPowerCap = p.type === 'capacitor' && (pin0Rail?.type === 'vcc' || pin0Rail?.type === 'gnd' || pin1Rail?.type === 'vcc' || pin1Rail?.type === 'gnd');

        if (isPowerCap && icPos.length > 0) {
          // Place in the gap between ICs, vertically with V+ top and GND bottom
          const sortedICs = [...icPos].sort((a, b) => a.y - b.y);
          let gapY: number;
          if (sortedICs.length >= 2) {
            const gapTop = sortedICs[0].y + sortedICs[0].h;
            const gapBot = sortedICs[1].y;
            gapY = gapTop + (gapBot - gapTop) / 2;
          } else {
            gapY = sortedICs[0].y + sortedICs[0].h + 3 * GRID;
          }
          // Power caps go outside all other passives, in the gap between ICs
          const rightEdge = passiveLayout.reduce((max, pl) => Math.max(max, pl.x1, pl.x2), sortedICs[0].x + IC_W);
          const px = rightEdge + 4 * GRID + fallbackPowerIdx * 4 * GRID;
          passiveLayout.push({ comp: p, x1: px, y1: gapY - 2 * GRID, x2: px, y2: gapY + 2 * GRID, orientation: 'v' });
          pinXY.set(`${p.id}:0`, { x: px, y: gapY - 2 * GRID });
          pinXY.set(`${p.id}:1`, { x: px, y: gapY + 2 * GRID });
          fallbackPowerIdx++;
        } else {
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

  // Joined terminal tracking
  const joinedPinsSet = new Set<string>();
  const joinedWiresList: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; color: string; label: string }> = [];
  const SIGNAL_COLORS_MAP: Record<string, string> = {
    'SAW': '#ff8844', 'PULSE': '#cc44cc', 'TRI': '#44cc44',
    '1V/OCT': '#44aadd', 'CV': '#44aadd', 'PW': '#ddaa44',
    'SYNC': '#dd4444', 'SCALE': '#aa88cc', 'TRIM': '#aa88cc',
  };
  const joinedPins = joinedPinsSet;
  const joinedWires = joinedWiresList;

  // Routing column system — layers allocated outward from IC edges
  // Order from IC outward: passives → signal joins → I/O → V+ → GND
  const COL_SPACING_RT = GRID;
  const icLeftX = layout.icPos.length > 0 ? Math.min(...layout.icPos.map(p => p.x)) - GRID : 10 * GRID;
  const icRightX = layout.icPos.length > 0 ? Math.max(...layout.icPos.map(p => p.x + IC_W)) + GRID : 20 * GRID;

  // Passive edges (furthest non-power passive from IC)
  const nonPowerPassives = layout.passiveLayout.filter(p => p.orientation !== 'v');
  const passiveLeftX = nonPowerPassives.reduce((min, p) => Math.min(min, p.x1, p.x2), icLeftX) - GRID;
  const passiveRightX = nonPowerPassives.reduce((max, p) => Math.max(max, p.x1, p.x2), icRightX) + GRID;

  // Left side columns (going further left from passives):
  // Layer 1: Signal joins (closest to passives)
  const LEFT_SIGNAL_COL = (i: number) => passiveLeftX - 2 * GRID - i * COL_SPACING_RT;
  // Layer 2: V+ (outside signal joins)
  const LEFT_VCC_COL = passiveLeftX - 6 * GRID;
  // Layer 3: GND (outermost)
  const LEFT_GND_COL = passiveLeftX - 8 * GRID;

  // Right side columns (going further right from passives):
  const RIGHT_SIGNAL_COL = (i: number) => passiveRightX + 2 * GRID + i * COL_SPACING_RT;
  const RIGHT_VCC_COL = passiveRightX + 6 * GRID;
  const RIGHT_GND_COL = passiveRightX + 8 * GRID;

  const svgW = 90 * GRID;
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

        {/* Net connections — simple direct wires */}
        {(() => {
          // For each net: draw a single horizontal wire connecting all positions at the same Y.
          // Only draw vertical wires when a net connects pins at different heights
          // and those pins are adjacent (same X column).
          // No complex routing — keep it simple and clean.

          const icCenterX = layout.icPos.length > 0 ? layout.icPos[0].x + IC_W / 2 : svgW / 2;
          const allJunctions: Array<{ x: number; y: number; color: string }> = [];

          const rendered = nets.map((net, ni) => {
            if (net.connections.length < 2) return null;
            const color = NET_COLORS[ni % NET_COLORS.length];
            const wires: React.JSX.Element[] = [];

            const positions = net.connections
              .map(c => layout.pinXY.get(`${c.componentId}:${c.pinIndex}`))
              .filter(Boolean) as Array<{ x: number; y: number }>;

            if (positions.length < 2) return null;

            // Group by Y (rounded to 4px)
            const rows = new Map<number, Array<{ x: number; y: number }>>();
            for (const p of positions) {
              const ry = Math.round(p.y / 4) * 4;
              if (!rows.has(ry)) rows.set(ry, []);
              rows.get(ry)!.push(p);
            }

            // Draw horizontal connections within each row
            let wi = 0;
            for (const [, group] of rows) {
              if (group.length < 2) continue;
              group.sort((a, b) => a.x - b.x);
              // One line from leftmost to rightmost
              wires.push(
                <line key={`h${ni}-${wi++}`}
                  x1={group[0].x} y1={group[0].y}
                  x2={group[group.length - 1].x} y2={group[group.length - 1].y}
                  stroke={color} strokeWidth={1.5}
                />
              );
              // Junction at each intermediate point
              for (const p of group) {
                allJunctions.push({ x: p.x, y: p.y, color });
              }
            }

            return <g key={`net-${ni}`}>{wires}</g>;
          });

          return (
            <>
              {rendered}
              {/* Draw all junction dots on top */}
              {allJunctions.map((j, i) => (
                <Junction key={`jall-${i}`} x={j.x} y={j.y} />
              ))}
            </>
          );
        })()}

        {/* IC symbols */}
        {layout.icPos.map(({ comp, x, y }) => (
          <ICSymbol
            key={comp.id} x={x} y={y} comp={comp}
            selected={selectedItemId === comp.id}
            onSelect={() => selectItem(comp.id, 'component')}
          />
        ))}

        {/* Find matching terminal pairs to join with wires */}
        {(() => {
          // Collect all output and input terminals with positions
          const outputs: Array<{ key: string; label: string; pos: { x: number; y: number } }> = [];
          const inputs: Array<{ key: string; label: string; pos: { x: number; y: number } }> = [];

          for (const [key, term] of terminals) {
            const pos = layout.pinXY.get(key);
            if (!pos) continue;
            if (term.type === 'output') outputs.push({ key, label: term.label, pos });
            if (term.type === 'input') inputs.push({ key, label: term.label, pos });
          }

          // Match pairs by signal name
          const SIGNAL_PAIRS: Record<string, string[]> = {
            'SAW': ['SAW IN', 'SAW OUT'],
            'PULSE': ['PULSE IN', 'PULSE OUT'],
            'TRI': ['TRI IN', 'TRI OUT'],
          };

          // Also match direct name matches
          for (const out of outputs) {
            for (const inp of inputs) {
              // Direct match: output "SAW" matches input "SAW IN"
              const outBase = out.label.replace(' OUT', '').replace('OUT', '');
              const inBase = inp.label.replace(' IN', '').replace('IN', '');
              if (outBase === inBase || out.label === inp.label) {
                joinedPinsSet.add(out.key);
                joinedPinsSet.add(inp.key);

                const color = SIGNAL_COLORS_MAP[outBase] ?? SIGNAL_COLORS_MAP[out.label] ?? '#888';
                joinedWiresList.push({
                  from: out.pos,
                  to: inp.pos,
                  color,
                  label: outBase || out.label,
                });
              }
            }
          }

          return null; // rendering happens below
        })()}

        {/* Passive symbols inline */}
        {layout.passiveLayout.map(({ comp, x1, y1, x2, y2 }) => {
          const selected = selectedItemId === comp.id;
          const value = formatValue(comp);

          // Get terminal info and positions for both pins
          const term0 = terminals.get(`${comp.id}:0`);
          const term1 = terminals.get(`${comp.id}:1`);
          const pos0 = layout.pinXY.get(`${comp.id}:0`);
          const pos1 = layout.pinXY.get(`${comp.id}:1`);

          // Determine terminal side: pin further from IC center is the "outer" side
          const icCx = layout.icPos.length > 0 ? layout.icPos[0].x + IC_W / 2 : 0;
          function termSide(pos: { x: number; y: number } | undefined): 'left' | 'right' {
            if (!pos) return 'left';
            return pos.x < icCx ? 'left' : 'right';
          }

          return (
            <g key={comp.id} onClick={() => selectItem(comp.id, 'component')} style={{ cursor: 'pointer' }}>
              {comp.type === 'resistor' && drawResistor(x1, y1, x2, y2, comp.label ?? '', value, selected)}
              {comp.type === 'capacitor' && drawCapacitor(x1, y1, x2, y2, comp.label ?? '', value, selected)}
              {comp.type === 'diode' && (() => {
                const anodePos = layout.pinXY.get(`${comp.id}:0`); // pin 0 = anode
                return drawDiode(x1, y1, x2, y2, comp.label ?? '', selected, anodePos?.x);
              })()}
              {comp.type === 'potentiometer' && drawResistor(x1, y1, x2, y2, comp.label ?? '', value, selected)}

              {/* Terminal symbols at the actual pin positions — skip if joined */}
              {term0 && pos0 && !joinedPins.has(`${comp.id}:0`) && <TerminalSymbol x={pos0.x} y={pos0.y} terminal={term0} side={termSide(pos0)} vccCol={termSide(pos0) === 'right' ? RIGHT_VCC_COL : LEFT_VCC_COL} gndCol={termSide(pos0) === 'right' ? RIGHT_GND_COL : LEFT_GND_COL} />}
              {term1 && pos1 && !joinedPins.has(`${comp.id}:1`) && <TerminalSymbol x={pos1.x} y={pos1.y} terminal={term1} side={termSide(pos1)} vccCol={termSide(pos1) === 'right' ? RIGHT_VCC_COL : LEFT_VCC_COL} gndCol={termSide(pos1) === 'right' ? RIGHT_GND_COL : LEFT_GND_COL} />}
            </g>
          );
        })}

        {/* Joined terminal connections — routed OUTSIDE everything, never through ICs */}
        {joinedWires.map(({ from, to, color, label }, i) => {
          const icCx = layout.icPos.length > 0 ? layout.icPos[0].x + IC_W / 2 : svgW / 2;
          const fromLeft = from.x < icCx;
          const toLeft = to.x < icCx;
          const bothLeft = fromLeft && toLeft;
          const bothRight = !fromLeft && !toLeft;

          let d: string;

          if (bothLeft) {
            // Both on left — simple left-side route
            const routeX = LEFT_SIGNAL_COL(i);
            d = `M${from.x},${from.y} L${routeX},${from.y} L${routeX},${to.y} L${to.x},${to.y}`;
          } else if (bothRight) {
            // Both on right — simple right-side route
            const routeX = RIGHT_SIGNAL_COL(i);
            d = `M${from.x},${from.y} L${routeX},${from.y} L${routeX},${to.y} L${to.x},${to.y}`;
          } else {
            // Cross-side: route around ICs via the LEFT side (outside everything)
            const routeX = LEFT_SIGNAL_COL(i);
            // Find gap between ICs for horizontal crossing
            const sortedICs = [...layout.icPos].sort((a, b) => a.y - b.y);
            let gapY = (from.y + to.y) / 2; // fallback
            if (sortedICs.length >= 2) {
              for (let g = 0; g < sortedICs.length - 1; g++) {
                const gTop = sortedICs[g].y + sortedICs[g].h;
                const gBot = sortedICs[g + 1].y;
                if (gBot - gTop > GRID) {
                  gapY = gTop + (gBot - gTop) / 2;
                  break;
                }
              }
            }
            // Route: from → left column → down to gap → across gap → right to destination → destination
            const rightX = Math.max(from.x, to.x);
            const leftPt = fromLeft ? from : to;
            const rightPt = fromLeft ? to : from;
            d = `M${leftPt.x},${leftPt.y} L${routeX},${leftPt.y} L${routeX},${gapY} L${rightPt.x},${gapY} L${rightPt.x},${rightPt.y}`;
          }

          // Label position: on the vertical segment
          const labelX = bothLeft ? LEFT_SIGNAL_COL(i) : bothRight ? RIGHT_SIGNAL_COL(i) : LEFT_SIGNAL_COL(i);

          return (
            <g key={`join-${i}`}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 3" />
              <text
                x={labelX - 6} y={(from.y + to.y) / 2 + 4}
                fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold"
                textAnchor="end"
              >
                {label}
              </text>
              <Junction x={from.x} y={from.y} />
              <Junction x={to.x} y={to.y} />
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
