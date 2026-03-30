import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
  softClip,
} from '../types';

/**
 * CEM3320 Voltage-Controlled Filter
 *
 * The Curtis CEM3320 is a 4-pole (24dB/oct) voltage-controlled filter
 * used in the Prophet-5 (Rev 3), OB-Xa, Memorymoog, and others.
 *
 * Features:
 * - 4-pole (24dB/oct) low-pass filter
 * - Voltage-controlled resonance
 * - Multiple signal inputs with +/- polarity
 * - 2-pole (bandpass) and 4-pole (lowpass) outputs
 * - Self-oscillation at high resonance
 *
 * Pin mapping (DIP-18):
 *  0: SIG IN 1+     9: GND
 *  1: SIG IN 1-     10: V+
 *  2: SIG IN 2-     11: BP OUT
 *  3: SIG IN 2+     12: LP OUT
 *  4: FREQ CV 1     13: OUTPUT
 *  5: FREQ CV 2     14: RES IN
 *  6: FREQ CV 3     15: Q COMP
 *  7: RESONANCE     16: N/C
 *  8: V-            17: N/C
 *
 * State variables:
 *  [0..3] 4 integrator states (one per pole)
 */

// Pin indices
const PIN_SIG_IN_1P = 0;
const PIN_SIG_IN_1N = 1;
const PIN_SIG_IN_2N = 2;
const PIN_SIG_IN_2P = 3;
const PIN_FREQ_CV1 = 4;
const PIN_FREQ_CV2 = 5;
const PIN_FREQ_CV3 = 6;
const PIN_RESONANCE = 7;
const PIN_BP_OUT = 11;
const PIN_LP_OUT = 12;
const PIN_OUTPUT = 13;

const cem3320: ICModel = {
  type: 'CEM3320',
  name: 'CEM3320 VCF',
  pinCount: 18,
  stateSize: 4,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(4),
      outputs: new Float64Array(18),
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

    // ---- Input signal (sum of ± inputs) ----
    const sigIn = (inputs[PIN_SIG_IN_1P] ?? 0)
                - (inputs[PIN_SIG_IN_1N] ?? 0)
                + (inputs[PIN_SIG_IN_2P] ?? 0)
                - (inputs[PIN_SIG_IN_2N] ?? 0);

    // ---- Cutoff frequency from CV inputs ----
    const cv1 = inputs[PIN_FREQ_CV1] ?? 0;
    const cv2 = inputs[PIN_FREQ_CV2] ?? 0;
    const cv3 = inputs[PIN_FREQ_CV3] ?? 0;
    const totalCV = cv1 + cv2 + cv3;
    const cutoffFreq = cvToFrequency(totalCV, 261.63);

    // ---- Resonance (0–4 for self-oscillation at 4) ----
    const resInput = inputs[PIN_RESONANCE] ?? 0;
    // Map 0–5V to 0–4 resonance range
    const resonance = Math.max(0, Math.min(4.0, resInput * 0.8));

    // ---- Filter coefficient ----
    // Bilinear-transformed one-pole cutoff coefficient
    const wc = 2 * Math.PI * cutoffFreq;
    const g = Math.tanh(wc * dt * 0.5);  // Nonlinear for Behavioral

    if (fidelity === Fidelity.Block) {
      // ---- Simple 4-pole cascade (linear, no saturation) ----
      const feedback = resonance * s[3];
      const input = sigIn - feedback;

      s[0] += g * (input - s[0]);
      s[1] += g * (s[0] - s[1]);
      s[2] += g * (s[1] - s[2]);
      s[3] += g * (s[2] - s[3]);

      out[PIN_BP_OUT] = s[1];
      out[PIN_LP_OUT] = s[3];
      out[PIN_OUTPUT] = s[3];
    } else {
      // ---- Behavioral: nonlinear ladder with saturation ----
      // Each stage has tanh saturation, modeling the OTA nonlinearity
      // characteristic of the CEM3320.
      //
      // The CEM3320 uses OTA-based integrators which saturate
      // gracefully, giving it a warm, slightly compressed character
      // distinct from the SSM and Roland ladder designs.

      const feedback = resonance * softClip(s[3], 1.0);
      const input = softClip(sigIn - feedback, 0.8);

      // 4-stage cascade with per-stage saturation
      s[0] += g * (softClip(input, 1.0) - s[0]);
      s[1] += g * (softClip(s[0], 1.0) - s[1]);
      s[2] += g * (softClip(s[1], 1.0) - s[2]);
      s[3] += g * (softClip(s[2], 1.0) - s[3]);

      out[PIN_BP_OUT] = s[1] * 5.0;
      out[PIN_LP_OUT] = s[3] * 5.0;
      out[PIN_OUTPUT] = s[3] * 5.0;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(cem3320);

export { cem3320 };
