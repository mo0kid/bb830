import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  cvToFrequency,
} from '../types';

/**
 * SSI2144 Voltage-Controlled Filter
 *
 * Sound Semiconductor's modern reissue based on the SSM2044 topology.
 * 4-pole (24dB/oct) low-pass filter with integrated capacitors —
 * all four poles track uniformly (unlike the SSM2045's external caps).
 *
 * Character: Clean, well-behaved 4-pole response. Smooth resonance.
 * Less "character" than the SSM2045's asymmetric poles but more
 * predictable tracking. Good starting point for matching — needs
 * external shaping network to approximate the CMI-01A sound.
 *
 * To match SSM2045 character, consider:
 *   - Adding a parallel high-pass shelf after the filter
 *   - Using a frequency-dependent feedback network
 *   - Adding slight even-harmonic saturation at the input
 *
 * Pin mapping (DIP-16):
 *  0: INPUT          8: RESONANCE
 *  1: AUDIO SUM      9: OUTPUT
 *  2: V-            10-15: N/C
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

const ssi2144: ICModel = {
  type: 'SSI2144',
  name: 'SSI2144 VCF',
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

    // Optional per-pole cap tuning — when set, the SSI2144 can approximate
    // the SSM2045's asymmetric response via external shaping.
    // Default: uniform (all poles same frequency). Set cap1-cap4 to diverge.
    const cap1 = params['cap1'] ?? 0;
    const cap2 = params['cap2'] ?? 0;
    const cap3 = params['cap3'] ?? 0;
    const cap4 = params['cap4'] ?? 0;
    const hasAsymmetry = cap1 > 0;

    let g1: number, g2: number, g3: number, g4: number;

    if (hasAsymmetry) {
      // Asymmetric mode: per-pole cutoff scaled by cap ratios
      const refCap = cap1;
      const f1 = cutoff * (refCap / cap1);
      const f2 = cutoff * (refCap / cap2);
      const f3 = cutoff * (refCap / cap3);
      const f4 = cutoff * (refCap / cap4);
      g1 = Math.tanh(2 * Math.PI * f1 * dt * 0.5);
      g2 = Math.tanh(2 * Math.PI * f2 * dt * 0.5);
      g3 = Math.tanh(2 * Math.PI * f3 * dt * 0.5);
      g4 = Math.tanh(2 * Math.PI * f4 * dt * 0.5);
    } else {
      const wc = 2 * Math.PI * cutoff;
      const g = Math.tanh(wc * dt * 0.5);
      g1 = g2 = g3 = g4 = g;
    }

    // Drive and saturation parameters for matching
    const drive = params['drive'] ?? 0.85;
    const sat = params['saturation'] ?? 1.0;

    if (fidelity === Fidelity.Block) {
      const feedback = resonance * s[3];
      const input = sigIn - feedback;

      s[0] += g1 * (input - s[0]);
      s[1] += g2 * (s[0] - s[1]);
      s[2] += g3 * (s[1] - s[2]);
      s[3] += g4 * (s[2] - s[3]);

      out[PIN_OUTPUT] = s[3];
    } else {
      const feedback = resonance * Math.tanh(s[3] * 0.95);
      const input = Math.tanh((sigIn - feedback) * drive);

      s[0] += g1 * (Math.tanh(input * sat) - s[0]);
      s[1] += g2 * (Math.tanh(s[0] * sat) - s[1]);
      s[2] += g3 * (Math.tanh(s[1] * sat) - s[2]);
      s[3] += g4 * (Math.tanh(s[2] * sat) - s[3]);

      out[PIN_OUTPUT] = s[3] * 5.0;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(ssi2144);

export { ssi2144 };
