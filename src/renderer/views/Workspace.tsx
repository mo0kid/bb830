import React, { useRef, useCallback, useState, type WheelEvent, type MouseEvent } from 'react';
import { useCircuitStore } from '../stores/circuit-store';
import { useUIStore } from '../stores/ui-store';
import { BreadboardView } from './BreadboardView';
import { SchematicView } from './SchematicView';

class SchematicErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#e94560', fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '100%' }}>
          <h3>Schematic Error</h3>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: 11, color: '#888' }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 10, padding: '4px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const BOARD_SLOT_WIDTH = 500;
const BOARD_SLOT_HEIGHT = 960;
const BOARD_GAP = 40;

export function Workspace() {
  const { project, currentBoardId, setCurrentBoard } = useCircuitStore();
  const { viewMode, zoom, setZoom, panOffset, setPanOffset } = useUIStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Zoom with mouse wheel
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom(zoom + delta);
  }, [zoom, setZoom]);

  // Pan with middle mouse or alt+drag
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey) || useUIStore.getState().toolMode === 'pan') {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      e.preventDefault();
    }
  }, [panOffset]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      setPanOffset(e.clientX - panStart.x, e.clientY - panStart.y);
    }
  }, [isPanning, panStart, setPanOffset]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Multi-board breadboard layout
  const boardCount = project.boards.length;
  const isSchematic = viewMode === 'schematic';

  return (
    <div
      style={styles.workspace}
      onWheel={isSchematic ? undefined : handleWheel}
      onMouseDown={isSchematic ? undefined : handleMouseDown}
      onMouseMove={isSchematic ? undefined : handleMouseMove}
      onMouseUp={isSchematic ? undefined : handleMouseUp}
      onMouseLeave={isSchematic ? undefined : handleMouseUp}
    >
      {/* Schematic overlay — rendered on top, breadboard stays alive underneath */}
      {isSchematic && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#111' }}>
          <SchematicErrorBoundary>
            <SchematicView />
          </SchematicErrorBoundary>
        </div>
      )}

      <div style={{
        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        position: 'absolute',
        display: 'flex',
        gap: BOARD_GAP,
        padding: 20,
        visibility: isSchematic ? 'hidden' : 'visible',
      }}>
        {project.boards.map((board, idx) => (
          <div
            key={board.id}
            data-board-id={board.id}
            data-board-idx={idx}
            style={{
              width: BOARD_SLOT_WIDTH,
              height: BOARD_SLOT_HEIGHT,
              position: 'relative',
              flexShrink: 0,
            }}
            onClick={() => setCurrentBoard(board.id)}
          >
            {/* Board label tab */}
            <div style={{
              ...styles.boardTab,
              ...(board.id === currentBoardId ? styles.boardTabActive : {}),
            }}>
              {board.label}
            </div>

            {/* Active board border */}
            {board.id === currentBoardId && (
              <div style={styles.activeBorder} />
            )}

            <BreadboardView board={board} />
          </div>
        ))}

        {/* Inter-board wire overlay */}
        {project.interBoardWires.length > 0 && (
          <svg style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: boardCount * (BOARD_SLOT_WIDTH + BOARD_GAP) + 40,
            height: BOARD_SLOT_HEIGHT + 60,
            pointerEvents: 'none',
            overflow: 'visible',
          }}>
            {project.interBoardWires.map(ibw => {
              const fromIdx = project.boards.findIndex(b => b.id === ibw.fromBoardId);
              const toIdx = project.boards.findIndex(b => b.id === ibw.toBoardId);
              if (fromIdx < 0 || toIdx < 0) return null;

              const fromBoardX = 20 + fromIdx * (BOARD_SLOT_WIDTH + BOARD_GAP);
              const toBoardX = 20 + toIdx * (BOARD_SLOT_WIDTH + BOARD_GAP);

              // Approximate pin position within board (center-ish)
              const fromX = fromBoardX + BOARD_SLOT_WIDTH / 2;
              const toX = toBoardX + BOARD_SLOT_WIDTH / 2;
              const fromY = 30 + ('row' in ibw.fromPosition ? (ibw.fromPosition.row - 1) * 14 : 0);
              const toY = 30 + ('row' in ibw.toPosition ? (ibw.toPosition.row - 1) * 14 : 0);

              const WIRE_COLORS: Record<string, string> = {
                red: '#ff3333', black: '#222', blue: '#3366ff', green: '#33cc66',
                yellow: '#ffcc00', orange: '#ff8800', white: '#ddd', purple: '#9933ff',
              };
              const color = WIRE_COLORS[ibw.color] ?? '#3366ff';
              const midY = Math.min(fromY, toY) - 30;

              return (
                <path
                  key={ibw.id}
                  d={`M${fromX},${fromY} C${fromX},${midY} ${toX},${midY} ${toX},${toY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={3}
                  strokeDasharray="6 3"
                  opacity={0.8}
                />
              );
            })}
          </svg>
        )}
      </div>

      {/* Zoom indicator */}
      <div style={styles.zoomLabel}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  workspace: {
    flex: 1,
    background: '#111',
    overflow: 'hidden',
    position: 'relative',
    cursor: 'default',
  },
  boardTab: {
    position: 'absolute',
    top: -24,
    left: 0,
    padding: '3px 12px',
    background: '#1a1a2e',
    border: '1px solid #333',
    borderBottom: 'none',
    borderRadius: '4px 4px 0 0',
    color: '#888',
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: 600,
    zIndex: 10,
  },
  boardTabActive: {
    background: '#0f3460',
    borderColor: '#e94560',
    color: '#fff',
  },
  activeBorder: {
    position: 'absolute',
    inset: -2,
    border: '2px solid #e94560',
    borderRadius: 8,
    pointerEvents: 'none' as const,
    zIndex: 5,
  },
  zoomLabel: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    padding: '2px 8px',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    color: '#888',
    fontSize: 11,
    fontFamily: 'inherit',
    pointerEvents: 'none' as const,
  },
};
