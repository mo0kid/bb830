import { useCircuitStore } from '../stores/circuit-store';
import { COMPONENT_LIBRARY } from '../panels/ComponentLibrary';

/**
 * SchematicView — SVG block diagram showing ICs as labeled boxes
 * with signal flow connections between them.
 */

const BLOCK_WIDTH = 140;
const BLOCK_HEIGHT = 60;
const BLOCK_GAP_X = 80;
const BLOCK_GAP_Y = 40;
const COLS = 3;

// Category colors for block borders
const CATEGORY_COLORS: Record<string, string> = {
  vco: '#e94560',
  vcf: '#3366ff',
  vca: '#2ecc71',
  opamp: '#aaaaaa',
  transistor: '#cc8833',
  diode: '#ff8800',
  resistor: '#d4a574',
  capacitor: '#6699cc',
  potentiometer: '#999999',
};

export function SchematicView() {
  const { project } = useCircuitStore();
  const components = project.netlist.components;
  const nets = project.netlist.nets;

  if (components.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>Schematic View</div>
          <div style={styles.emptySub}>Place components on the board to see the block diagram</div>
        </div>
      </div>
    );
  }

  // Layout components in a grid
  const blocks = components.map((comp, idx) => {
    const def = COMPONENT_LIBRARY.find(c => c.type === comp.type);
    const category = def?.category ?? 'opamp';
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = 40 + col * (BLOCK_WIDTH + BLOCK_GAP_X);
    const y = 40 + row * (BLOCK_HEIGHT + BLOCK_GAP_Y);
    return { comp, def, category, x, y };
  });

  // Build connection lines from nets
  const connections: Array<{ x1: number; y1: number; x2: number; y2: number; netName: string }> = [];
  for (const net of nets) {
    if (net.connections.length < 2) continue;
    const pinRefs = net.connections;
    // Connect first pin to all others
    const srcBlock = blocks.find(b => b.comp.id === pinRefs[0].componentId);
    if (!srcBlock) continue;

    for (let i = 1; i < pinRefs.length; i++) {
      const dstBlock = blocks.find(b => b.comp.id === pinRefs[i].componentId);
      if (!dstBlock) continue;

      connections.push({
        x1: srcBlock.x + BLOCK_WIDTH,
        y1: srcBlock.y + BLOCK_HEIGHT / 2,
        x2: dstBlock.x,
        y2: dstBlock.y + BLOCK_HEIGHT / 2,
        netName: net.name ?? net.id,
      });
    }
  }

  const svgWidth = COLS * (BLOCK_WIDTH + BLOCK_GAP_X) + 80;
  const svgHeight = Math.ceil(components.length / COLS) * (BLOCK_HEIGHT + BLOCK_GAP_Y) + 80;

  return (
    <div style={styles.container}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={styles.svg}
      >
        {/* Connection lines */}
        {connections.map((conn, idx) => {
          const midX = (conn.x1 + conn.x2) / 2;
          return (
            <g key={`conn-${idx}`}>
              <path
                d={`M${conn.x1},${conn.y1} C${midX},${conn.y1} ${midX},${conn.y2} ${conn.x2},${conn.y2}`}
                fill="none"
                stroke="#e94560"
                strokeWidth={2}
                opacity={0.6}
              />
              <text
                x={midX}
                y={Math.min(conn.y1, conn.y2) - 4}
                fill="#e94560"
                fontSize={9}
                fontFamily="monospace"
                textAnchor="middle"
                opacity={0.8}
              >
                {conn.netName}
              </text>
            </g>
          );
        })}

        {/* Component blocks */}
        {blocks.map(({ comp, def, category, x, y }) => {
          const color = CATEGORY_COLORS[category] ?? '#888';
          const pinCount = comp.pins.length;

          return (
            <g key={comp.id}>
              {/* Block body */}
              <rect
                x={x} y={y}
                width={BLOCK_WIDTH} height={BLOCK_HEIGHT}
                rx={4} ry={4}
                fill="#1a1a2e"
                stroke={color}
                strokeWidth={2}
              />

              {/* Component type */}
              <text
                x={x + BLOCK_WIDTH / 2} y={y + 20}
                fill={color}
                fontSize={12}
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                {comp.type}
              </text>

              {/* Component label */}
              <text
                x={x + BLOCK_WIDTH / 2} y={y + 36}
                fill="#888"
                fontSize={10}
                fontFamily="monospace"
                textAnchor="middle"
              >
                {comp.label !== comp.type ? comp.label : ''}
              </text>

              {/* Package info */}
              <text
                x={x + BLOCK_WIDTH / 2} y={y + 52}
                fill="#555"
                fontSize={9}
                fontFamily="monospace"
                textAnchor="middle"
              >
                {comp.package} · {pinCount} pins
              </text>

              {/* Pin stubs on left */}
              {comp.pins.slice(0, Math.ceil(pinCount / 2)).map((pin, i) => {
                const py = y + 10 + i * 12;
                if (py > y + BLOCK_HEIGHT - 4) return null;
                return (
                  <g key={`l${pin.index}`}>
                    <line x1={x - 8} y1={py} x2={x} y2={py} stroke="#666" strokeWidth={1.5} />
                    <text x={x - 10} y={py + 3} fill="#666" fontSize={7} fontFamily="monospace" textAnchor="end">
                      {pin.name}
                    </text>
                  </g>
                );
              })}

              {/* Pin stubs on right */}
              {comp.pins.slice(Math.ceil(pinCount / 2)).map((pin, i) => {
                const py = y + 10 + i * 12;
                if (py > y + BLOCK_HEIGHT - 4) return null;
                return (
                  <g key={`r${pin.index}`}>
                    <line x1={x + BLOCK_WIDTH} y1={py} x2={x + BLOCK_WIDTH + 8} y2={py} stroke="#666" strokeWidth={1.5} />
                    <text x={x + BLOCK_WIDTH + 10} y={py + 3} fill="#666" fontSize={7} fontFamily="monospace">
                      {pin.name}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    background: '#111',
  },
  svg: {
    display: 'block',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: '#444',
  },
  emptySub: {
    fontSize: 14,
    marginTop: 8,
    color: '#333',
  },
};
