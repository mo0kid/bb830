import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
  softClip,
} from '../types';

/**
 * SSM2040 Voltage-Controlled Filter
 *
 * The Solid State Music SSM2040 is a 4-pole (24dB/oct) low-pass filter
 * used in the Prophet-5 Rev 1-2 and other early polysynths.
 *
 * Character: aggressive, slightly gritty at high resonance, with
 * notable bass loss under resonance (a defining trait of the early
 * Prophet-5 sound). The filter self-oscillates cleanly.
 *
 * Key difference from CEM3320: the SSM2040 uses a different
 * ladder topology with more pronounced nonlinear saturation,
 * giving it a rawer, more aggressive character.
 *
 * Pin mapping (DIP-16):
 *  0: SIG IN        8: V+
 *  1: AUDIO SUM     9: N/C
 *  2: FREQ CV 1     10: N/C
 *  3: FREQ CV 2     11: RES
 *  4: FREQ CV 3     12: RES CAP
 *  5: FREQ CV SUM   13: POLE 4 OUT
 *  6: V-            14: POLE 2 OUT
 *  7: GND           15: N/C
 *
 * State: [0..3] four integrator states
 */

const PIN_SIG_IN = 0;
const PIN_AUDIO_SUM = 1;
const PIN_FREQ_CV1 = 2;
const PIN_FREQ_CV2 = 3;
const PIN_FREQ_CV3 = 4;
const PIN_FREQ_CV_SUM = 5;
const PIN_RES = 11;
const PIN_POLE4_OUT = 13;
const PIN_POLE2_OUT = 14;

const ssm2040: ICModel = {
  type: 'SSM2040',
  name: 'SSM2040 VCF',
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

    // ---- Input signal ----
    const sigIn = (inputs[PIN_SIG_IN] ?? 0) + (inputs[PIN_AUDIO_SUM] ?? 0);

    // ---- Cutoff frequency ----
    const cv = (inputs[PIN_FREQ_CV1] ?? 0)
             + (inputs[PIN_FREQ_CV2] ?? 0)
             + (inputs[PIN_FREQ_CV3] ?? 0)
             + (inputs[PIN_FREQ_CV_SUM] ?? 0);
    const cutoff = cvToFrequency(cv, 261.63);

    // ---- Resonance ----
    const resV = inputs[PIN_RES] ?? 0;
    const resonance = Math.max(0, Math.min(4.2, resV * 0.84));

    // ---- Filter coefficient ----
    const wc = 2 * Math.PI * cutoff;
    const g = Math.tanh(wc * dt * 0.5);

    if (fidelity === Fidelity.Block) {
      const feedback = resonance * s[3];
      const input = sigIn - feedback;

      s[0] += g * (input - s[0]);
      s[1] += g * (s[0] - s[1]);
      s[2] += g * (s[1] - s[2]);
      s[3] += g * (s[2] - s[3]);

      out[PIN_POLE2_OUT] = s[1];
      out[PIN_POLE4_OUT] = s[3];
    } else {
      // SSM2040 behavioral character:
      // - Harder saturation than CEM3320 (more aggressive clipping)
      // - Notable bass loss at high resonance
      // - Each stage clips more aggressively

      const feedback = resonance * Math.tanh(s[3]);
      // SSM2040 characteristic: input is heavily driven
      const input = Math.tanh((sigIn - feedback) * 1.2);

      // Bass loss compensation at high resonance
      // The SSM2040 notably thins out the bass when Q is cranked
      const bassLoss = 1.0 - resonance * 0.15;

      // Harder per-stage saturation than CEM3320
      s[0] += g * (Math.tanh(input * 1.5) - s[0]) * bassLoss;
      s[1] += g * (Math.tanh(s[0] * 1.3) - s[1]);
      s[2] += g * (Math.tanh(s[1] * 1.3) - s[2]);
      s[3] += g * (Math.tanh(s[2] * 1.3) - s[3]);

      out[PIN_POLE2_OUT] = s[1] * 5.0;
      out[PIN_POLE4_OUT] = s[3] * 5.0;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(ssm2040);

export { ssm2040 };
