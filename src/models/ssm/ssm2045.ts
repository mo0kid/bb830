import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
} from '../types';

/**
 * SSM2045 Voltage-Controlled Filter
 *
 * The SSM2045 is a tracking filter used in vintage sampling synthesizers.
 * Unlike the SSM2044, it exposes individual capacitor connections for each
 * of the four OTA filter poles, allowing asymmetric pole frequencies.
 *
 * Typical tracking caps: C1=10nF, C2=3.3nF, C3=10nF, C4=2.2nF.
 * This asymmetry creates a distinctive filter character —
 * the poles track together via the shared frequency CV but each has a
 * different absolute cutoff, producing a non-uniform rolloff slope that
 * emphasizes certain harmonics as the filter sweeps.
 *
 * Pin mapping (DIP-18):
 *  0: SIG IN       9: GND
 *  1: CAP 1       10: V- (Vee)
 *  2: CAP 2       11: N/C (MIXER 6)
 *  3: 2P OUT      12: N/C (MIXER 5)
 *  4: N/C         13: N/C (MIXER 4)
 *  5: CAP 3       14: N/C (MIXER 3)
 *  6: CAP 4       15: N/C (MIXER 2)
 *  7: OUTPUT      16: N/C (MIXER 1)
 *  8: V+ (Vcc)    17: FREQ CV
 *
 * State: [0..3] four integrator states, [4] input smoothing
 *
 * Parameters:
 *   cap1..cap4: capacitance values in farads (default: typical tracking values)
 */

const PIN_SIG_IN = 0;
const PIN_CAP1 = 1;
const PIN_CAP2 = 2;
const PIN_2P_OUT = 3;
const PIN_CAP3 = 5;
const PIN_CAP4 = 6;
const PIN_OUTPUT = 7;
const PIN_FREQ_CV = 17;

const ssm2045: ICModel = {
  type: 'SSM2045',
  name: 'SSM2045 VCF',
  pinCount: 18,
  stateSize: 5,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(5),
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

    const sigIn = inputs[PIN_SIG_IN] ?? 0;

    // Frequency CV: exponential control
    const cv = inputs[PIN_FREQ_CV] ?? 0;
    const baseFreq = cvToFrequency(cv, 261.63);

    // External cap values determine each pole's cutoff relative to base
    // Default: typical tracking filter cap values
    const cap1 = params['cap1'] ?? 10e-9;   // 10nF
    const cap2 = params['cap2'] ?? 3.3e-9;  // 3.3nF
    const cap3 = params['cap3'] ?? 10e-9;   // 10nF
    const cap4 = params['cap4'] ?? 2.2e-9;  // 2.2nF

    // Each pole's cutoff scales inversely with its cap value
    // Normalized to 10nF reference (largest cap = lowest freq pole)
    const refCap = 10e-9;
    const f1 = baseFreq * (refCap / cap1);  // 1.0x
    const f2 = baseFreq * (refCap / cap2);  // ~3.03x higher
    const f3 = baseFreq * (refCap / cap3);  // 1.0x
    const f4 = baseFreq * (refCap / cap4);  // ~4.55x higher

    // Per-pole integration coefficients
    const g1 = Math.tanh(2 * Math.PI * f1 * dt * 0.5);
    const g2 = Math.tanh(2 * Math.PI * f2 * dt * 0.5);
    const g3 = Math.tanh(2 * Math.PI * f3 * dt * 0.5);
    const g4 = Math.tanh(2 * Math.PI * f4 * dt * 0.5);

    // Resonance from feedback (no dedicated pin — set by external resistor network)
    const resonance = params['resonance'] ?? 0;

    if (fidelity === Fidelity.Block) {
      const feedback = resonance * s[3];
      const input = sigIn - feedback;

      s[0] += g1 * (input - s[0]);
      s[1] += g2 * (s[0] - s[1]);
      s[2] += g3 * (s[1] - s[2]);
      s[3] += g4 * (s[2] - s[3]);

      out[PIN_2P_OUT] = s[1];
      out[PIN_OUTPUT] = s[3];
    } else {
      // Behavioral: SSM2045 OTA character
      // Each OTA stage has soft saturation (gentler than SSM2040)
      // The asymmetric poles create frequency-dependent harmonic emphasis
      // At low cutoffs, poles 2 & 4 (smaller caps) are relatively faster,
      // letting more upper harmonics through — this is the "airy" quality

      const feedback = resonance * Math.tanh(s[3] * 0.85);
      const input = Math.tanh((sigIn - feedback) * 0.8);

      // Input smoothing (models the SSM2045's input buffer bandwidth)
      s[4] += 0.3 * (input - s[4]);

      // Four asymmetric OTA stages with individual saturation
      s[0] += g1 * (Math.tanh(s[4] * 1.1) - s[0]);
      s[1] += g2 * (Math.tanh(s[0] * 1.05) - s[1]);
      s[2] += g3 * (Math.tanh(s[1] * 1.1) - s[2]);
      s[3] += g4 * (Math.tanh(s[2] * 1.05) - s[3]);

      out[PIN_2P_OUT] = s[1] * 5.0;
      out[PIN_OUTPUT] = s[3] * 5.0;
    }

    // Mirror pole voltages to cap pins (for probing)
    out[PIN_CAP1] = s[0];
    out[PIN_CAP2] = s[1];
    out[PIN_CAP3] = s[2];
    out[PIN_CAP4] = s[3];
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(ssm2045);

export { ssm2045 };
