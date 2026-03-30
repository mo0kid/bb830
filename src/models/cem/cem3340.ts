import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
  softClip,
} from '../types';

/**
 * CEM3340 Voltage-Controlled Oscillator
 *
 * The Curtis CEM3340 is the definitive analog VCO IC, used in the
 * Sequential Prophet-5 (Rev 3), Roland Jupiter-6/8, Oberheim OB-Xa,
 * Moog Memorymoog, and many others.
 *
 * Features:
 * - Saw, triangle, and variable-width pulse outputs
 * - 1V/octave exponential CV input
 * - Hard and soft sync
 * - Temperature-compensated exponential converter
 *
 * Pin mapping (DIP-16):
 *  0: RAMP OUT      8: TIMING CAP
 *  1: GND           9: TIMING RES
 *  2: PULSE OUT     10: V+
 *  3: PW IN         11: V-
 *  4: SOFT SYNC     12: TRI OUT
 *  5: HARD SYNC     13: COMP IN
 *  6: FREQ CV SUM   14: SCALE TRIM
 *  7: FREQ CV IN    15: SCALE IN
 *
 * State variables:
 *  [0] phase (0..1 sawtooth ramp)
 *  [1] sync latch (for edge detection)
 *  [2] previous hard sync input (for edge detection)
 */

// Pin indices
const PIN_RAMP_OUT = 0;
const PIN_PULSE_OUT = 2;
const PIN_PW_IN = 3;
const PIN_SOFT_SYNC = 4;
const PIN_HARD_SYNC = 5;
const PIN_FREQ_CV_SUM = 6;
const PIN_FREQ_CV_IN = 7;
const PIN_TRI_OUT = 12;
const PIN_SCALE_IN = 15;

// State indices
const STATE_PHASE = 0;
const STATE_SYNC_LATCH = 1;
const STATE_PREV_SYNC = 2;

const cem3340: ICModel = {
  type: 'CEM3340',
  name: 'CEM3340 VCO',
  pinCount: 16,
  stateSize: 3,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(3),
      outputs: new Float64Array(16),
    };
  },

  reset(state: ModelState): void {
    state.state.fill(0);
    state.outputs.fill(0);
  },

  process(
    state: ModelState,
    inputs: Float64Array,
    params: Record<string, number>,
    dt: number,
    fidelity: Fidelity,
  ): void {
    const s = state.state;
    const out = state.outputs;

    // ---- Frequency calculation ----
    // Sum CV inputs: FREQ CV IN (1V/oct) + FREQ CV SUM + SCALE IN
    const cvIn = inputs[PIN_FREQ_CV_IN] ?? 0;
    const cvSum = inputs[PIN_FREQ_CV_SUM] ?? 0;
    const scaleIn = inputs[PIN_SCALE_IN] ?? 0;
    const totalCV = cvIn + cvSum + scaleIn;

    // Convert to frequency: 1V/octave, 0V = middle C (261.63 Hz)
    const freq = cvToFrequency(totalCV, 261.63);

    // ---- Pulse width ----
    // PW input: 0V = 50%, ±5V range maps to ~5%–95%
    const pwInput = inputs[PIN_PW_IN] ?? 0;
    const pulseWidth = Math.max(0.05, Math.min(0.95, 0.5 + pwInput * 0.09));

    // ---- Phase increment ----
    const phaseInc = freq * dt;

    // ---- Hard sync ----
    const syncIn = inputs[PIN_HARD_SYNC] ?? 0;
    const prevSync = s[STATE_PREV_SYNC];
    const syncEdge = syncIn > 0.5 && prevSync <= 0.5;  // Rising edge
    s[STATE_PREV_SYNC] = syncIn;

    if (syncEdge) {
      s[STATE_PHASE] = 0;
    }

    // ---- Advance phase ----
    s[STATE_PHASE] += phaseInc;
    if (s[STATE_PHASE] >= 1.0) {
      s[STATE_PHASE] -= 1.0;
    }

    const phase = s[STATE_PHASE];

    // ---- Generate waveforms ----

    if (fidelity === Fidelity.Block) {
      // Simple ideal waveforms
      // Saw: -5V to +5V linear ramp
      out[PIN_RAMP_OUT] = phase * 10.0 - 5.0;

      // Triangle: derived from saw
      out[PIN_TRI_OUT] = phase < 0.5
        ? phase * 20.0 - 5.0
        : (1.0 - phase) * 20.0 - 5.0;

      // Pulse
      out[PIN_PULSE_OUT] = phase < pulseWidth ? 5.0 : -5.0;
    } else {
      // Behavioral: add analog character

      // Saw with slight soft clipping at extremes (CEM3340 characteristic)
      const rawSaw = phase * 10.0 - 5.0;
      out[PIN_RAMP_OUT] = softClip(rawSaw, 0.95) * 5.2;

      // Triangle: slight asymmetry and rounding typical of real CEM3340
      // The triangle is generated from an integrator, giving slightly
      // rounded peaks compared to an ideal triangle
      const rawTri = phase < 0.5
        ? phase * 20.0 - 5.0
        : (1.0 - phase) * 20.0 - 5.0;
      // Soft clip the peaks — real triangle output isn't perfectly sharp
      out[PIN_TRI_OUT] = softClip(rawTri * 0.22, 1.0) * 4.8;

      // Pulse: slight ringing on edges (comparator behavior)
      // The CEM3340 pulse output has a small overshoot on transitions
      const pulseRaw = phase < pulseWidth ? 5.0 : -5.0;
      const prevPulse = out[PIN_PULSE_OUT];
      // Simple one-pole filter for edge rounding
      const edgeSmooth = 1.0 - Math.exp(-dt * freq * 20.0);
      out[PIN_PULSE_OUT] = prevPulse + (pulseRaw - prevPulse) * edgeSmooth;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(cem3340);

export { cem3340 };
