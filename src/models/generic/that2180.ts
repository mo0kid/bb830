import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * THAT 2180 Voltage-Controlled Amplifier
 *
 * THAT Corporation's modern successor to the dbx 2150/2155.
 * Same Blackmer-cell topology but with improved specs — lower noise,
 * lower distortion, tighter control law accuracy.
 *
 * Character: Cleaner and more transparent than the dbx 2150.
 * Less even-harmonic coloration, wider bandwidth, lower noise floor.
 * The "correct" modern choice but needs external shaping to match
 * the dbx 2150's warmer character.
 *
 * To match dbx 2150 character, consider:
 *   - Adding a soft-clipping diode pair at the output (1N4148)
 *   - Using a feedback resistor network for subtle 2nd harmonic
 *   - Reducing the control bandwidth with an RC filter on EC
 *
 * Control law: 6mV/dB (exponential) — same as dbx 2150
 * Dynamic range: >120dB
 * THD: <0.01% at 0dB gain (significantly cleaner than dbx 2150)
 *
 * Pin mapping (DIP-8):
 *  0: SIG IN+      4: V-
 *  1: SIG IN-      5: SYM GND
 *  2: EC (control)  6: SIG OUT
 *  3: V+           7: BYPASS
 *
 * State: [0] gain smoothing
 */

const PIN_SIG_INP = 0;
const PIN_SIG_INN = 1;
const PIN_EC = 2;
const PIN_SIG_OUT = 6;

const that2180: ICModel = {
  type: 'THAT2180',
  name: 'THAT 2180 VCA',
  pinCount: 8,
  stateSize: 1,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(1),
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

    // Differential input
    const sigIn = (inputs[PIN_SIG_INP] ?? 0) - (inputs[PIN_SIG_INN] ?? 0);

    // Control voltage: 6mV/dB (same as dbx 2150)
    const ec = inputs[PIN_EC] ?? 0;
    const gainDb = ec / 0.006;
    const gainLin = Math.pow(10, gainDb / 20);
    const clampedGain = Math.max(0.00001, Math.min(10, gainLin));

    if (fidelity === Fidelity.Block) {
      out[PIN_SIG_OUT] = sigIn * clampedGain;
    } else {
      // Behavioral: THAT 2180 — cleaner Blackmer cell
      //
      // 1. Faster gain control bandwidth (~500kHz vs 200kHz)
      const gainSmooth = 1.0 - Math.exp(-2 * Math.PI * 500000 * dt);
      s[0] += gainSmooth * (clampedGain - s[0]);

      // 2. Much lower distortion — nearly ideal gain cell
      //    Only the subtlest hint of 2nd harmonic at extreme levels
      const sig = sigIn * s[0];
      const dist = params['distortion'] ?? 0.0005; // ~6x cleaner than dbx 2150
      const colored = sig + dist * sig * Math.abs(sig);

      // 3. Negligible control feedthrough (improved design)
      out[PIN_SIG_OUT] = colored;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(that2180);

export { that2180 };
