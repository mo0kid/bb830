import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  softClip,
} from '../types';

/**
 * TL072 Dual Operational Amplifier
 *
 * JFET-input dual op-amp, the workhorse of analog synth circuits.
 * Used for buffers, summing amplifiers, active filters, and
 * signal conditioning throughout virtually every voicecard design.
 *
 * Pin mapping (DIP-8):
 *  0: OUT A     4: IN B+
 *  1: IN A-     5: IN B-
 *  2: IN A+     6: OUT B
 *  3: V-        7: V+
 *
 * State: [0,1] output slew states for channels A and B
 */

const PIN_OUT_A = 0;
const PIN_IN_AN = 1;
const PIN_IN_AP = 2;
const PIN_IN_BP = 4;
const PIN_IN_BN = 5;
const PIN_OUT_B = 6;

const tl072: ICModel = {
  type: 'TL072',
  name: 'TL072 Dual Op-Amp',
  pinCount: 8,
  stateSize: 2,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(2),
      outputs: new Float64Array(8),
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

    // Open-loop gain (in practice limited by external feedback network)
    const gain = params['gain'] ?? 200000;
    const supplyV = params['supply'] ?? 12;

    // Channel A
    const diffA = (inputs[PIN_IN_AP] ?? 0) - (inputs[PIN_IN_AN] ?? 0);
    // Channel B
    const diffB = (inputs[PIN_IN_BP] ?? 0) - (inputs[PIN_IN_BN] ?? 0);

    if (fidelity === Fidelity.Block) {
      // Ideal op-amp: output = diff * gain, rail-clamped
      out[PIN_OUT_A] = Math.max(-supplyV, Math.min(supplyV, diffA * gain));
      out[PIN_OUT_B] = Math.max(-supplyV, Math.min(supplyV, diffB * gain));
    } else {
      // Behavioral: slew rate limiting and soft rail saturation
      // TL072 slew rate: ~13V/µs
      const slewRate = 13e6; // V/s
      const maxSlew = slewRate * dt;

      // Channel A
      const targetA = softClip(diffA * gain / supplyV, 1.0) * (supplyV - 1.2);
      const deltaA = targetA - s[0];
      s[0] += Math.max(-maxSlew, Math.min(maxSlew, deltaA));
      out[PIN_OUT_A] = s[0];

      // Channel B
      const targetB = softClip(diffB * gain / supplyV, 1.0) * (supplyV - 1.2);
      const deltaB = targetB - s[1];
      s[1] += Math.max(-maxSlew, Math.min(maxSlew, deltaB));
      out[PIN_OUT_B] = s[1];
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(tl072);

export { tl072 };
