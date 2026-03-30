import { useRef, useEffect, useState, useCallback } from 'react';
import { useSimStore } from '../stores/sim-store';
import { useCircuitStore } from '../stores/circuit-store';

/**
 * WaveformDisplay — dual A/B probe oscilloscope.
 * Probe A (green) and Probe B (red) overlaid with phase-locked trigger.
 */

const WAVE_HEIGHT_MIN = 120;
const WAVE_HEIGHT_MAX = 500;
const GRID_COLOR = '#1a2a4a';
const COLOR_A = '#00ff88';
const COLOR_B = '#ff4466';
const TRIGGER_COLOR = '#e94560';
const ZERO_LINE_COLOR = '#333';
const SCALE_V = 5.0;
const RING_SIZE = 8192;

function findTriggerInRing(
  ring: Float32Array, ringSize: number, wp: number,
  searchStart: number, searchEnd: number, level: number,
): number {
  const total = Math.min(wp, ringSize);
  const base = wp - total;
  for (let i = Math.max(1, searchStart); i < searchEnd; i++) {
    const idx0 = ((base + i - 1) % ringSize + ringSize) % ringSize;
    const idx1 = ((base + i) % ringSize + ringSize) % ringSize;
    if (ring[idx0] <= level && ring[idx1] > level) return i;
  }
  return -1;
}

function drawTrace(
  ctx: CanvasRenderingContext2D, ring: Float32Array, ringSize: number,
  wp: number, startIdx: number, displaySamples: number,
  w: number, h: number, color: string,
) {
  const midY = h / 2;
  const total = Math.min(wp, ringSize);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const si = startIdx + Math.floor((x / w) * displaySamples);
    const ri = ((wp - total + si) % ringSize + ringSize) % ringSize;
    const v = ring[ri] ?? 0;
    const y = midY - (v / SCALE_V) * midY;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function WaveformDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringA = useRef(new Float32Array(RING_SIZE));
  const ringB = useRef(new Float32Array(RING_SIZE));
  const wpA = useRef(0);
  const wpB = useRef(0);
  const { probeData, probeDataB, probeNetId, probeNetIdB, status } = useSimStore();
  const nets = useCircuitStore(s => s.project.netlist.nets);

  const [phaseLock, setPhaseLock] = useState(true);
  const [triggerLevel, setTriggerLevel] = useState(0);
  const [height, setHeight] = useState(WAVE_HEIGHT_MIN);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  // Accumulate probe A
  useEffect(() => {
    if (!probeData) return;
    const ring = ringA.current;
    for (let i = 0; i < probeData.length; i++) {
      ring[wpA.current % RING_SIZE] = probeData[i];
      wpA.current++;
    }
  }, [probeData]);

  // Accumulate probe B
  useEffect(() => {
    if (!probeDataB) return;
    const ring = ringB.current;
    for (let i = 0; i < probeDataB.length; i++) {
      ring[wpB.current % RING_SIZE] = probeDataB[i];
      wpB.current++;
    }
  }, [probeDataB]);

  // Render
  useEffect(() => {
    if (!canvasRef.current) return;
    if (!probeData && !probeDataB) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;

    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let v = -SCALE_V; v <= SCALE_V; v += 1) {
      const y = midY - (v / SCALE_V) * midY;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = ZERO_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Trigger line
    if (phaseLock) {
      const trigY = midY - (triggerLevel / SCALE_V) * midY;
      ctx.strokeStyle = TRIGGER_COLOR;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, trigY);
      ctx.lineTo(w, trigY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Trigger from probe A
    const totalA = Math.min(wpA.current, RING_SIZE);
    const displaySamples = Math.min(w * 2, totalA);
    let startIdx = totalA - displaySamples;

    if (phaseLock && totalA > displaySamples + 64) {
      const searchStart = totalA - displaySamples - 512;
      const searchEnd = totalA - displaySamples;
      const trigIdx = findTriggerInRing(ringA.current, RING_SIZE, wpA.current,
        Math.max(0, searchStart), searchEnd, triggerLevel);
      if (trigIdx >= 0) startIdx = trigIdx;
    }

    // Draw probe A (green)
    if (probeNetId && totalA > 0) {
      drawTrace(ctx, ringA.current, RING_SIZE, wpA.current, startIdx, displaySamples, w, h, COLOR_A);
    }

    // Draw probe B (red) — same time alignment as A
    const totalB = Math.min(wpB.current, RING_SIZE);
    if (probeNetIdB && totalB > 0) {
      // Use same startIdx ratio so both traces are time-aligned
      const startB = Math.min(startIdx, totalB - displaySamples);
      drawTrace(ctx, ringB.current, RING_SIZE, wpB.current, Math.max(0, startB), displaySamples, w, h, COLOR_B);
    }

    // Scale labels
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.fillText(`+${SCALE_V}V`, 4, 12);
    ctx.fillText('0V', 4, midY - 2);
    ctx.fillText(`-${SCALE_V}V`, 4, h - 4);

    // Probe labels
    if (probeNetId) {
      const nameA = nets.find(n => n.id === probeNetId)?.name ?? probeNetId;
      ctx.fillStyle = COLOR_A;
      ctx.font = '10px monospace';
      ctx.fillText(`A: ${nameA}`, w - ctx.measureText(`A: ${nameA}`).width - 8, 14);
    }
    if (probeNetIdB) {
      const nameB = nets.find(n => n.id === probeNetIdB)?.name ?? probeNetIdB;
      ctx.fillStyle = COLOR_B;
      ctx.font = '10px monospace';
      ctx.fillText(`B: ${nameB}`, w - ctx.measureText(`B: ${nameB}`).width - 8, 26);
    }
  }, [probeData, probeDataB, probeNetId, probeNetIdB, phaseLock, triggerLevel, nets]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!phaseLock || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleY = canvasRef.current.height / rect.height;
    const y = (e.clientY - rect.top) * scaleY;
    const midY = canvasRef.current.height / 2;
    const v = -((y - midY) / midY) * SCALE_V;
    setTriggerLevel(Math.round(v * 10) / 10);
  }, [phaseLock]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = height;
    const handleMove = (ev: MouseEvent) => {
      const delta = dragStartY.current - ev.clientY;
      setHeight(Math.max(WAVE_HEIGHT_MIN, Math.min(WAVE_HEIGHT_MAX, dragStartH.current + delta)));
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [height]);

  // Net selector for A/B probes
  const setProbeA = useSimStore(s => s.setProbeNet);
  const setProbeB = useSimStore(s => s.setProbeNetB);

  const hasProbe = probeNetId || probeNetIdB;

  return (
    <div style={{ ...styles.container, height: hasProbe ? height : 'auto' }}>
      {/* Drag handle */}
      {hasProbe && (
        <div onMouseDown={handleDragStart} style={styles.dragHandle}>
          <div style={styles.dragGrip} />
        </div>
      )}

      {/* A/B probe selectors */}
      <div style={styles.probeSelectors}>
        <label style={{ ...styles.probeLabel, color: COLOR_A }}>
          A:
          <select
            value={probeNetId ?? ''}
            onChange={e => setProbeA(e.target.value || null)}
            style={{ ...styles.probeSelect, borderColor: COLOR_A }}
          >
            <option value="">—</option>
            {nets.map(n => <option key={n.id} value={n.id}>{n.name ?? n.id}</option>)}
          </select>
        </label>
        <label style={{ ...styles.probeLabel, color: COLOR_B }}>
          B:
          <select
            value={probeNetIdB ?? ''}
            onChange={e => setProbeB(e.target.value || null)}
            style={{ ...styles.probeSelect, borderColor: COLOR_B }}
          >
            <option value="">—</option>
            {nets.map(n => <option key={n.id} value={n.id}>{n.name ?? n.id}</option>)}
          </select>
        </label>
      </div>

      {hasProbe && (
        <>
          <canvas
            ref={canvasRef}
            width={800}
            height={Math.max(60, height - 28)}
            style={{ ...styles.canvas, height: height - 28 }}
            onClick={handleCanvasClick}
          />
          <div style={styles.controls}>
            {status === 'running' && <span style={styles.liveIndicator}>LIVE</span>}
            <button
              onClick={() => setPhaseLock(!phaseLock)}
              style={{ ...styles.lockBtn, background: phaseLock ? '#e94560' : '#333' }}
              title={phaseLock ? `Trigger: ${triggerLevel}V` : 'Free-run mode'}
            >
              {phaseLock ? 'TRIG' : 'FREE'}
            </button>
          </div>
        </>
      )}

      {!hasProbe && (
        <div style={styles.empty}>Select probe nets above</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    borderTop: '1px solid #0f3460',
    background: '#0a0a1a',
    flexShrink: 0,
  },
  dragHandle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 8,
    cursor: 'ns-resize',
    zIndex: 10,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragGrip: {
    width: 40,
    height: 3,
    borderRadius: 2,
    background: '#333',
  },
  probeSelectors: {
    display: 'flex',
    gap: 12,
    padding: '4px 8px',
    borderBottom: '1px solid #1a2a4a',
    background: '#0a0a1a',
  },
  probeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 700,
  },
  probeSelect: {
    background: '#111',
    color: '#ccc',
    border: '1px solid #333',
    borderRadius: 3,
    fontSize: 10,
    fontFamily: 'monospace',
    padding: '1px 4px',
    outline: 'none',
  },
  canvas: {
    width: '100%',
    display: 'block',
    cursor: 'crosshair',
  },
  empty: {
    padding: 12,
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
  },
  controls: {
    position: 'absolute',
    bottom: 6,
    left: 4,
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  liveIndicator: {
    padding: '2px 6px',
    background: '#e94560',
    borderRadius: 3,
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
  },
  lockBtn: {
    padding: '2px 6px',
    border: 'none',
    borderRadius: 3,
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: 'pointer',
  },
};
