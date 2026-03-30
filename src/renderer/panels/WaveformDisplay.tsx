import { useRef, useEffect } from 'react';
import { useSimStore } from '../stores/sim-store';

/**
 * WaveformDisplay — renders probe waveform data on a canvas.
 * Shows a scrolling oscilloscope-style view of the probed net voltage.
 */

const WAVE_HEIGHT = 120;
const GRID_COLOR = '#1a2a4a';
const WAVE_COLOR = '#00ff88';
const ZERO_LINE_COLOR = '#333';
const SCALE_V = 5.0;  // ±5V display range

export function WaveformDisplay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { probeData, probeNetId, status } = useSimStore();

  useEffect(() => {
    if (!canvasRef.current || !probeData) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
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

    // Waveform
    ctx.strokeStyle = WAVE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const samplesPerPixel = Math.max(1, Math.floor(probeData.length / w));

    for (let x = 0; x < w; x++) {
      const sampleIdx = Math.floor((x / w) * probeData.length);
      const v = probeData[sampleIdx] ?? 0;
      const y = midY - (v / SCALE_V) * midY;

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Scale labels
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.fillText(`+${SCALE_V}V`, 4, 12);
    ctx.fillText('0V', 4, midY - 2);
    ctx.fillText(`-${SCALE_V}V`, 4, h - 4);

    // Net label
    if (probeNetId) {
      ctx.fillStyle = WAVE_COLOR;
      ctx.font = '10px monospace';
      ctx.fillText(probeNetId, w - ctx.measureText(probeNetId).width - 8, 14);
    }
  }, [probeData, probeNetId]);

  if (!probeNetId) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>Select a net to probe</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <canvas
        ref={canvasRef}
        width={400}
        height={WAVE_HEIGHT}
        style={styles.canvas}
      />
      {status === 'running' && (
        <div style={styles.liveIndicator}>LIVE</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    borderTop: '1px solid #0f3460',
    background: '#0a0a1a',
  },
  canvas: {
    width: '100%',
    height: WAVE_HEIGHT,
    display: 'block',
  },
  empty: {
    padding: 12,
    color: '#444',
    fontSize: 11,
    textAlign: 'center',
  },
  liveIndicator: {
    position: 'absolute',
    top: 6,
    left: 8,
    padding: '2px 6px',
    background: '#e94560',
    borderRadius: 3,
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
  },
};
