import { useSimStore } from '../stores/sim-store';
import { useCircuitStore } from '../stores/circuit-store';
import { Fidelity } from '../../models/types';

const FIDELITY_OPTIONS = [
  { value: Fidelity.Block, label: 'Block', desc: 'Fast — ideal transfer functions' },
  { value: Fidelity.Behavioral, label: 'Behavioral', desc: 'Real-time — analog character' },
  { value: Fidelity.Component, label: 'Component', desc: 'Offline — full accuracy' },
];

export function SimControls() {
  const { status, fidelity, probeNetId, setFidelity, setProbeNet, start, stop } = useSimStore();
  const { project } = useCircuitStore();

  const handleStartStop = () => {
    if (status === 'running') {
      stop();
    } else {
      const { components } = project.netlist;
      const nets = project.netlist.nets;
      start(
        components.map(c => ({ id: c.id, type: c.type, parameters: c.parameters })),
        nets.map(n => ({ id: n.id, connections: n.connections })),
      );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Simulation</div>
        <button onClick={handleStartStop} style={{
          ...styles.btn,
          background: status === 'running' ? '#e94560' : '#2ecc71',
          color: '#fff',
        }}>
          {status === 'running' ? 'Stop' : 'Run'}
        </button>
        <span style={statusDot(status)} />
        <span style={styles.statusText}>
          {status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Stopped'}
        </span>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>Fidelity</div>
        {FIDELITY_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFidelity(opt.value)}
            style={{
              ...styles.fidelityBtn,
              ...(fidelity === opt.value ? styles.fidelityActive : {}),
            }}
            title={opt.desc}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>Probe</div>
        <select
          value={probeNetId ?? ''}
          onChange={e => setProbeNet(e.target.value || null)}
          style={styles.select}
        >
          <option value="">None</option>
          {project.netlist.nets.map(n => (
            <option key={n.id} value={n.id}>
              {n.name ?? n.id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function statusDot(status: string): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: status === 'running' ? '#2ecc71' : status === 'error' ? '#e94560' : '#666',
    marginLeft: 4,
  };
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '6px 12px',
    background: '#12192e',
    borderBottom: '1px solid #0f3460',
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginRight: 4,
  },
  btn: {
    padding: '4px 14px',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  statusText: {
    fontSize: 11,
    color: '#888',
  },
  fidelityBtn: {
    padding: '3px 8px',
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'inherit',
  },
  fidelityActive: {
    background: '#0f3460',
    borderColor: '#e94560',
    color: '#fff',
  },
  select: {
    padding: '3px 6px',
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'inherit',
    minWidth: 120,
  },
};
