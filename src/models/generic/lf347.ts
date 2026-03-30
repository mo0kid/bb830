import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  softClip,
} from '../types';

/**
 * LF347 Quad JFET Operational Amplifier
 *
 * Quad version of the LF347/TL074 family — the workhorse op-amp of
 * the Fairlight CMI-01A voice card. Used for:
 *   - DAC output buffering (F3, F4)
 *   - Filter control voltage scaling (F10)
 *   - Envelope shaping (F6)
 *   - VCA output buffering (F4, F6)
 *
 * Very similar to TL074 but with slightly better slew rate and
 * bandwidth. JFET input = high impedance, low bias current.
 *
 * Pin mapping (DIP-14):
 *  0: OUT A       7: OUT C
 *  1: IN A-       8: IN C-
 *  2: IN A+       9: IN C+
 *  3: V+         10: V-
 *  4: IN B+      11: IN D+
 *  5: IN B-      12: IN D-
 *  6: OUT B      13: OUT D
 *
 * State: [0..3] output slew states for channels A-D
 */

const PIN_OUT_A = 0;
const PIN_IN_AN = 1;
const PIN_IN_AP = 2;
const PIN_IN_BP = 4;
const PIN_IN_BN = 5;
const PIN_OUT_B = 6;
const PIN_OUT_C = 7;
const PIN_IN_CN = 8;
const PIN_IN_CP = 9;
const PIN_IN_DP = 11;
const PIN_IN_DN = 12;
const PIN_OUT_D = 13;

const lf347: ICModel = {
  type: 'LF347',
  name: 'LF347 Quad Op-Amp',
  pinCount: 14,
  stateSize: 4,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(4),
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

    const gain = params['gain'] ?? 200000;
    const supplyV = params['supply'] ?? 15; // CMI uses ±15V

    // Differential inputs for all four channels
    const diffA = (inputs[PIN_IN_AP] ?? 0) - (inputs[PIN_IN_AN] ?? 0);
    const diffB = (inputs[PIN_IN_BP] ?? 0) - (inputs[PIN_IN_BN] ?? 0);
    const diffC = (inputs[PIN_IN_CP] ?? 0) - (inputs[PIN_IN_CN] ?? 0);
    const diffD = (inputs[PIN_IN_DP] ?? 0) - (inputs[PIN_IN_DN] ?? 0);

    if (fidelity === Fidelity.Block) {
      out[PIN_OUT_A] = Math.max(-supplyV, Math.min(supplyV, diffA * gain));
      out[PIN_OUT_B] = Math.max(-supplyV, Math.min(supplyV, diffB * gain));
      out[PIN_OUT_C] = Math.max(-supplyV, Math.min(supplyV, diffC * gain));
      out[PIN_OUT_D] = Math.max(-supplyV, Math.min(supplyV, diffD * gain));
    } else {
      // LF347 slew rate: ~13V/µs (same family as TL074)
      const slewRate = 13e6;
      const maxSlew = slewRate * dt;
      const railDrop = 1.5; // JFET output stage drops ~1.5V from rail

      const diffs = [diffA, diffB, diffC, diffD];
      const pins = [PIN_OUT_A, PIN_OUT_B, PIN_OUT_C, PIN_OUT_D];

      for (let ch = 0; ch < 4; ch++) {
        const target = softClip(diffs[ch] * gain / supplyV, 1.0) * (supplyV - railDrop);
        const delta = target - s[ch];
        s[ch] += Math.max(-maxSlew, Math.min(maxSlew, delta));
        out[pins[ch]] = s[ch];
      }
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(lf347);

export { lf347 };
