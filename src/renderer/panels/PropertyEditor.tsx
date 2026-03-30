import { useState, useEffect } from 'react';
import { useCircuitStore } from '../stores/circuit-store';
import { useUIStore } from '../stores/ui-store';
import type { Pin } from '../../shared/netlist-types';

/** Number input that uses local state for free editing, syncs to store on blur/enter */
function ParamInput({ value, onChange, style }: { value: number; onChange: (v: number) => void; style: React.CSSProperties }) {
  const [text, setText] = useState(String(value));

  // Sync from store when the value changes externally
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const v = parseFloat(text);
    if (isFinite(v)) {
      onChange(v);
    } else {
      setText(String(value)); // revert to store value
    }
  };

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      style={style}
    />
  );
}

export function PropertyEditor() {
  const { project, updateComponentParameter, removeComponent, removeWire } = useCircuitStore();
  const { selectedItemId, selectedItemType, selectItem, hoveredPin, setHoveredPin } = useUIStore();

  if (!selectedItemId || !selectedItemType) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>Properties</div>
        <div style={styles.empty}>Select a component or wire</div>
      </div>
    );
  }

  if (selectedItemType === 'component') {
    const component = project.netlist.components.find(c => c.id === selectedItemId);
    if (!component) return null;

    return (
      <div style={styles.panel}>
        <div style={styles.header}>Properties</div>
        <div style={styles.section}>
          <div style={styles.label}>Type</div>
          <div style={styles.value}>{component.type}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>Label</div>
          <div style={styles.value}>{component.label ?? component.id}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>Package</div>
          <div style={styles.value}>{component.package}</div>
        </div>

        {/* Parameters */}
        {Object.entries(component.parameters).map(([key, value]) => (
          <div key={key} style={styles.section}>
            <div style={styles.label}>{key}</div>
            <ParamInput
              value={value}
              onChange={v => updateComponentParameter(component.id, key, v)}
              style={styles.input}
            />
          </div>
        ))}

        {/* Pins */}
        <div style={styles.sectionHeader}>Pins</div>
        {component.pins.map(pin => {
          const isHovered = hoveredPin?.componentId === component.id && hoveredPin?.pinIndex === pin.index;
          return (
            <div
              key={pin.index}
              style={{
                ...styles.pinRow,
                background: isHovered ? '#0f3460' : 'transparent',
                color: isHovered ? '#fff' : undefined,
              }}
              onMouseEnter={() => setHoveredPin({ componentId: component.id, pinIndex: pin.index })}
              onMouseLeave={() => setHoveredPin(null)}
            >
              <span style={styles.pinIndex}>{pin.index + 1}</span>
              <span style={{ ...styles.pinName, color: isHovered ? '#00ff88' : '#ccc' }}>{pin.name}</span>
              <span style={styles.pinType}>{pin.type}</span>
            </div>
          );
        })}

        <button
          onClick={() => {
            removeComponent(selectedItemId);
            selectItem(null, null);
          }}
          style={styles.deleteBtn}
        >
          Remove
        </button>
      </div>
    );
  }

  // Wire selected
  return (
    <div style={styles.panel}>
      <div style={styles.header}>Wire</div>
      <div style={styles.section}>
        <div style={styles.label}>ID</div>
        <div style={styles.value}>{selectedItemId}</div>
      </div>
      <button
        onClick={() => {
          // Find which board the wire is on
          const board = project.boards.find(b => b.wires.some(w => w.id === selectedItemId));
          if (board) removeWire(board.id, selectedItemId);
          selectItem(null, null);
        }}
        style={styles.deleteBtn}
      >
        Remove
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    background: '#16213e',
    borderLeft: '1px solid #0f3460',
    overflowY: 'auto',
    flexShrink: 0,
  },
  header: {
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#e94560',
    borderBottom: '1px solid #0f3460',
  },
  empty: {
    padding: 12,
    color: '#666',
    fontSize: 12,
  },
  section: {
    padding: '4px 12px',
    borderBottom: '1px solid #0f3460',
  },
  sectionHeader: {
    padding: '8px 12px 4px',
    fontSize: 10,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  label: {
    fontSize: 10,
    color: '#888',
    marginBottom: 2,
  },
  value: {
    fontSize: 12,
    color: '#ccc',
  },
  input: {
    width: '100%',
    padding: '3px 6px',
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  pinRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    fontSize: 11,
    cursor: 'pointer',
    borderBottom: '1px solid #0a1a30',
    width: '100%',
    boxSizing: 'border-box',
  },
  pinIndex: {
    width: 16,
    color: '#666',
    textAlign: 'right',
  },
  pinName: {
    flex: 1,
    color: '#ccc',
  },
  pinType: {
    fontSize: 9,
    color: '#555',
  },
  deleteBtn: {
    width: 'calc(100% - 24px)',
    margin: '12px',
    padding: '6px',
    background: '#e94560',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
};
