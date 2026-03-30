import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * dbx 2150 Voltage-Controlled Amplifier
 *
 * The dbx 2150 is a Blackmer-cell VCA used in the Fairlight CMI Series II.
 * It provides true RMS-level control with exponential (dB-linear) gain law.
 * Originally designed for dbx noise reduction, repurposed as a high-quality
 * VCA in pro audio and synthesizer designs.
 *
 * Character: Subtle even-harmonic coloration at higher gains, smooth
 * compression-like dynamics. The Blackmer cell's class-AB operation
 * creates a warm, slightly "glued" sound that's part of the CMI character.
 * Control feedthrough at high frequencies adds subtle brightness modulation.
 *
 * Control law: 6mV/dB (exponential)
 * Dynamic range: ~110dB
 * THD: <0.05% at 0dB gain (slightly more at extremes — this is the color)
 *
 * Pin mapping (DIP-8):
 *  0: SIG IN+      4: V-
 *  1: SIG IN-      5: SYM GND
 *  2: EC (control)  6: SIG OUT
 *  3: V+           7: BYPASS
 *
 * State: [0] gain smoothing, [1] control feedthrough filter
 */

const PIN_SIG_INP = 0;
const PIN_SIG_INN = 1;
const PIN_EC = 2;
const PIN_SIG_OUT = 6;

const dbx2150: ICModel = {
  type: 'dbx2150',
  name: 'dbx 2150 VCA',
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

    // Differential input
    const sigIn = (inputs[PIN_SIG_INP] ?? 0) - (inputs[PIN_SIG_INN] ?? 0);

    // Control voltage: 6mV/dB exponential law
    // 0V = 0dB (unity), negative = attenuation, positive = gain
    const ec = inputs[PIN_EC] ?? 0;
    const gainDb = ec / 0.006; // 6mV per dB
    const gainLin = Math.pow(10, gainDb / 20);

    // Clamp to realistic range (-80dB to +20dB)
    const clampedGain = Math.max(0.0001, Math.min(10, gainLin));

    if (fidelity === Fidelity.Block) {
      out[PIN_SIG_OUT] = sigIn * clampedGain;
    } else {
      // Behavioral: dbx 2150 Blackmer cell characteristics
      //
      // 1. Gain smoothing — the Blackmer cell has finite bandwidth
      //    on its gain control path (~200kHz). This creates a subtle
      //    "slewing" effect on fast gain changes.
      const gainSmooth = 1.0 - Math.exp(-2 * Math.PI * 200000 * dt);
      s[0] += gainSmooth * (clampedGain - s[0]);

      // 2. Even-harmonic distortion — class-AB Blackmer cell produces
      //    subtle 2nd harmonic, more pronounced at high signal levels.
      //    This is the "warmth" of the original.
      const sig = sigIn * s[0];
      const dist = params['distortion'] ?? 0.003; // subtle by default
      const colored = sig + dist * sig * Math.abs(sig);

      // 3. Control feedthrough — high-frequency CV leaks slightly
      //    into the signal path. In the CMI this adds subtle
      //    brightness modulation correlated with envelope.
      const ftCoeff = 1.0 - Math.exp(-2 * Math.PI * 50000 * dt);
      s[1] += ftCoeff * (ec * 0.001 - s[1]);

      out[PIN_SIG_OUT] = colored + s[1];
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(dbx2150);

export { dbx2150 };
