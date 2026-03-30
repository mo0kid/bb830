import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  softClip,
} from '../types';

/**
 * CEM3360 Dual Voltage-Controlled Amplifier
 *
 * The Curtis CEM3360 is a dual VCA with selectable log/linear
 * response modes. Used in the Prophet-5, OB-Xa, and many other
 * classic polysynths for both audio and CV path VCA duties.
 *
 * Features:
 * - Two independent VCA channels (A and B)
 * - Selectable logarithmic or linear response per channel
 * - Wide dynamic range (~100dB)
 * - Low distortion in linear mode
 * - Temperature-compensated control inputs
 *
 * Pin mapping (DIP-14):
 *  0: CV A         7: OUT B
 *  1: MODE A       8: SIG IN B
 *  2: SIG IN A     9: MODE B
 *  3: OUT A        10: CV B
 *  4: GND          11: BIAS
 *  5: V-           12: GAIN SET
 *  6: V+           13: REF OUT
 *
 * State variables:
 *  [0] smoothed gain A (for slew limiting)
 *  [1] smoothed gain B
 */

// Pin indices
const PIN_CV_A = 0;
const PIN_MODE_A = 1;
const PIN_SIG_IN_A = 2;
const PIN_OUT_A = 3;
const PIN_OUT_B = 7;
const PIN_SIG_IN_B = 8;
const PIN_MODE_B = 9;
const PIN_CV_B = 10;

const cem3360: ICModel = {
  type: 'CEM3360',
  name: 'CEM3360 Dual VCA',
  pinCount: 14,
  stateSize: 2,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(2),
      outputs: new Float64Array(14),
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

    // Process channels A and B
    for (let ch = 0; ch < 2; ch++) {
      const cvPin = ch === 0 ? PIN_CV_A : PIN_CV_B;
      const modePin = ch === 0 ? PIN_MODE_A : PIN_MODE_B;
      const sigInPin = ch === 0 ? PIN_SIG_IN_A : PIN_SIG_IN_B;
      const outPin = ch === 0 ? PIN_OUT_A : PIN_OUT_B;

      const cv = inputs[cvPin] ?? 0;
      const modeV = inputs[modePin] ?? 0;
      const sigIn = inputs[sigInPin] ?? 0;

      // Mode: >2.5V = linear, <2.5V = logarithmic (exponential)
      const isLinear = modeV > 2.5;

      let gain: number;

      if (fidelity === Fidelity.Block) {
        // ---- Simple gain calculation ----
        if (isLinear) {
          // Linear mode: 0V = 0 gain, 5V = unity
          gain = Math.max(0, cv / 5.0);
        } else {
          // Log/exponential mode: ~20dB/V
          // 0V = unity, negative CV reduces gain exponentially
          gain = Math.pow(10, cv / 5.0);  // ~20dB per volt
          gain = Math.min(gain, 2.0);  // Clamp max
        }

        out[outPin] = sigIn * gain;
      } else {
        // ---- Behavioral: smooth gain changes, soft saturation ----
        if (isLinear) {
          gain = Math.max(0, cv / 5.0);
        } else {
          gain = Math.pow(10, cv / 5.0);
          gain = Math.min(gain, 2.0);
        }

        // Smooth the gain to avoid zipper noise
        // CEM3360 has a finite slew rate on the CV input
        const smoothCoeff = 1.0 - Math.exp(-dt * 2000.0);
        s[ch] += (gain - s[ch]) * smoothCoeff;
        const smoothedGain = s[ch];

        // Apply gain with soft saturation characteristic
        // The CEM3360 has a graceful saturation curve at high levels
        const raw = sigIn * smoothedGain;
        out[outPin] = softClip(raw * 0.2, 1.0) * 5.0;
      }
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(cem3360);

export { cem3360 };
