import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
} from '../types';

/**
 * SSM2044 Voltage-Controlled Filter
 *
 * The SSM2044 is the successor to the SSM2040, used in the
 * Korg Mono/Poly, Polysix, Trident, and E-mu Emulator.
 *
 * Character: smoother than the SSM2040 but still with pronounced
 * resonance character. Warmer and rounder than the CEM3320.
 * Less bass loss at high resonance compared to the SSM2040.
 * Distinctive "squelchy" resonance sweep.
 *
 * Pin mapping (DIP-16):
 *  0: INPUT          8: RESONANCE
 *  1: AUDIO SUM      9: OUTPUT
 *  2: V-             10-15: N/C
 *  3: FREQ CV 1
 *  4: FREQ CV SUM
 *  5: FREQ CV 2
 *  6: GND
 *  7: V+
 *
 * State: [0..3] four integrator states
 */

const PIN_INPUT = 0;
const PIN_AUDIO_SUM = 1;
const PIN_FREQ_CV1 = 3;
const PIN_FREQ_CV_SUM = 4;
const PIN_FREQ_CV2 = 5;
const PIN_RESONANCE = 8;
const PIN_OUTPUT = 9;

const ssm2044: ICModel = {
  type: 'SSM2044',
  name: 'SSM2044 VCF',
  pinCount: 16,
  stateSize: 4,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(4),
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

    const sigIn = (inputs[PIN_INPUT] ?? 0) + (inputs[PIN_AUDIO_SUM] ?? 0);

    const cv = (inputs[PIN_FREQ_CV1] ?? 0)
             + (inputs[PIN_FREQ_CV2] ?? 0)
             + (inputs[PIN_FREQ_CV_SUM] ?? 0);
    const cutoff = cvToFrequency(cv, 261.63);

    const resV = inputs[PIN_RESONANCE] ?? 0;
    const resonance = Math.max(0, Math.min(4.0, resV * 0.8));

    const wc = 2 * Math.PI * cutoff;
    const g = Math.tanh(wc * dt * 0.5);

    if (fidelity === Fidelity.Block) {
      const feedback = resonance * s[3];
      const input = sigIn - feedback;

      s[0] += g * (input - s[0]);
      s[1] += g * (s[0] - s[1]);
      s[2] += g * (s[1] - s[2]);
      s[3] += g * (s[2] - s[3]);

      out[PIN_OUTPUT] = s[3];
    } else {
      // SSM2044 behavioral character:
      // - Smoother saturation than SSM2040
      // - "Squelchy" resonance: slightly delayed feedback
      // - Less bass loss than SSM2040
      // - Warm, round character favored for pads and strings

      const feedback = resonance * Math.tanh(s[3] * 0.9);
      const input = Math.tanh((sigIn - feedback) * 0.9);

      // Softer saturation per stage — the SSM2044 is more refined
      s[0] += g * (Math.tanh(input) - s[0]);
      s[1] += g * (Math.tanh(s[0]) - s[1]);
      s[2] += g * (Math.tanh(s[1]) - s[2]);
      s[3] += g * (Math.tanh(s[2]) - s[3]);

      out[PIN_OUTPUT] = s[3] * 5.0;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(ssm2044);

export { ssm2044 };
