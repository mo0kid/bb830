import { useCallback } from 'react';
import { useCircuitStore } from './stores/circuit-store';
import { useUIStore, type ToolMode, type ViewMode } from './stores/ui-store';
import { Workspace } from './views/Workspace';
import { SimControls } from './views/SimControls';
import { ComponentLibrary } from './panels/ComponentLibrary';
import { PropertyEditor } from './panels/PropertyEditor';
import { WaveformDisplay } from './panels/WaveformDisplay';

const TOOL_BUTTONS: { mode: ToolMode; label: string; key: string }[] = [
  { mode: 'select', label: 'Select', key: 'V' },
  { mode: 'wire', label: 'Wire', key: 'W' },
  { mode: 'probe', label: 'Probe', key: 'P' },
  { mode: 'pan', label: 'Pan', key: 'H' },
];

const WIRE_COLORS = [
  'red', 'black', 'blue', 'green', 'yellow', 'orange', 'white', 'purple',
] as const;

export function App() {
  const { project, dirty, addBoard, currentBoardId, setCurrentBoard } = useCircuitStore();
  const { viewMode, setViewMode, toolMode, setToolMode, wireColor, setWireColor } = useUIStore();

  const handleSave = useCallback(async () => {
    try {
      const state = useCircuitStore.getState();
      const path = await window.bb830.project.save(state.project, state.filePath ?? undefined);
      if (path) state.setFilePath(path);
    } catch (err) {
      console.error('Save failed:', err);
      alert(`Save failed: ${err}`);
    }
  }, []);

  const handleOpen = useCallback(async () => {
    const loaded = await window.bb830.project.open();
    if (loaded) useCircuitStore.getState().loadProject(loaded);
  }, []);

  const handleNew = useCallback(() => {
    useCircuitStore.getState().newProject('Untitled');
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Title bar drag region */}
      <div className="titlebar-drag" style={{ height: 28, flexShrink: 0 }} />

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolGroup}>
          <button onClick={handleNew} style={styles.btn}>New</button>
          <button onClick={handleOpen} style={styles.btn}>Open</button>
          <button onClick={handleSave} style={styles.btn}>
            Save{dirty ? ' *' : ''}
          </button>
        </div>

        <div style={styles.divider} />

        <div style={styles.toolGroup}>
          {TOOL_BUTTONS.map(({ mode, label, key }) => (
            <button
              key={mode}
              onClick={() => setToolMode(mode)}
              style={{
                ...styles.btn,
                ...(toolMode === mode ? styles.btnActive : {}),
              }}
              title={`${label} (${key})`}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={styles.divider} />

        {/* Wire color picker */}
        {toolMode === 'wire' && (
          <div style={styles.toolGroup}>
            {WIRE_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setWireColor(c)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: wireColor === c ? '2px solid #fff' : '2px solid transparent',
                  backgroundColor: c === 'white' ? '#ddd' : c,
                  cursor: 'pointer',
                  margin: '0 2px',
                }}
                title={c}
              />
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* View toggle */}
        <div style={styles.toolGroup}>
          {(['breadboard', 'schematic'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                ...styles.btn,
                ...(viewMode === mode ? styles.btnActive : {}),
              }}
            >
              {mode === 'breadboard' ? 'Board' : 'Schematic'}
            </button>
          ))}
        </div>

        <div style={styles.divider} />

        {/* Board tabs */}
        <div style={styles.toolGroup}>
          {project.boards.map(b => (
            <button
              key={b.id}
              onClick={() => setCurrentBoard(b.id)}
              style={{
                ...styles.btn,
                ...(currentBoardId === b.id ? styles.btnActive : {}),
              }}
            >
              {b.label}
            </button>
          ))}
          {project.boards.length < 6 && (
            <button
              onClick={() => addBoard(`Board ${project.boards.length + 1}`)}
              style={styles.btn}
              title="Add board (max 6)"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Sim controls bar */}
      <SimControls />

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel: Component library */}
        <ComponentLibrary />

        {/* Center: Workspace + Waveform */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <Workspace />
          <WaveformDisplay />
        </div>

        {/* Right panel: Properties */}
        <PropertyEditor />
      </div>

      {/* Status bar */}
      <div style={styles.statusBar}>
        <span>{project.name}{dirty ? ' (modified)' : ''}</span>
        <span style={{ flex: 1 }} />
        <span>Boards: {project.boards.length}/6</span>
        <span style={{ margin: '0 12px' }}>|</span>
        <span>Components: {project.netlist.components.length}</span>
        <span style={{ margin: '0 12px' }}>|</span>
        <span>Nets: {project.netlist.nets.length}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    background: '#16213e',
    borderBottom: '1px solid #0f3460',
    gap: 4,
    flexShrink: 0,
  },
  toolGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  btn: {
    padding: '4px 10px',
    background: '#1a1a2e',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  btnActive: {
    background: '#0f3460',
    borderColor: '#e94560',
    color: '#fff',
  },
  divider: {
    width: 1,
    height: 20,
    background: '#333',
    margin: '0 6px',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '3px 12px',
    background: '#16213e',
    borderTop: '1px solid #0f3460',
    fontSize: 11,
    color: '#888',
    flexShrink: 0,
  },
};
