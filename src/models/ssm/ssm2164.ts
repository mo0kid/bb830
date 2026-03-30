import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  softClip,
} from '../types';

/**
 * SSM2164 Quad Voltage-Controlled Amplifier
 *
 * The SSM2164 (also V2164 from CoolAudio) is a quad VCA widely
 * used in Eurorack and modern analog synths. Each channel is an
 * independent current-in/current-out VCA with exponential control.
 *
 * Character: very clean and transparent in the audio path.
 * Exponential (log) response only — linear response requires
 * external linearization circuitry (unlike the CEM3360 which
 * has a mode pin).
 *
 * Features:
 * - 4 independent VCA channels
 * - Exponential (dB-linear) control: ~30mV/dB (-33dB/V)
 * - Wide dynamic range (~120dB)
 * - Low distortion, low noise
 * - Current-mode I/O (requires external op-amp for voltage I/O)
 *
 * Pin mapping (DIP-16):
 *  0: IN 1       8: CV 3
 *  1: CV 1       9: OUT 3
 *  2: OUT 1      10: V+
 *  3: V-         11: OUT 4
 *  4: OUT 2      12: CV 4
 *  5: CV 2       13: IN 4
 *  6: IN 2       14: GND
 *  7: IN 3       15: GND
 *
 * State: [0..3] smoothed gain per channel
 */

const CHANNELS = [
  { in: 0, cv: 1, out: 2 },
  { in: 6, cv: 5, out: 4 },
  { in: 7, cv: 8, out: 9 },
  { in: 13, cv: 12, out: 11 },
];

const ssm2164: ICModel = {
  type: 'SSM2164',
  name: 'SSM2164 Quad VCA',
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

    for (let ch = 0; ch < 4; ch++) {
      const { in: inPin, cv: cvPin, out: outPin } = CHANNELS[ch];
      const sigIn = inputs[inPin] ?? 0;
      const cv = inputs[cvPin] ?? 0;

      // SSM2164: exponential control, ~33dB per volt
      // 0V = unity gain, -1V = -33dB, -3V ≈ -100dB (off)
      // Positive CV > 0V gives gain > unity
      let gain: number;

      if (fidelity === Fidelity.Block) {
        // Simple exponential: 10^(cv * 33/20) where 33dB/V
        gain = Math.pow(10, cv * 33 / 20);
        gain = Math.min(gain, 10);  // Clamp runaway gain
        if (cv < -3) gain = 0;     // Below -100dB, treat as off

        out[outPin] = sigIn * gain;
      } else {
        // Behavioral: smooth CV response, very low distortion
        // The SSM2164 is notably cleaner than the CEM3360
        gain = Math.pow(10, cv * 33 / 20);
        gain = Math.min(gain, 10);
        if (cv < -3) gain = 0;

        // Smooth gain transitions (SSM2164 has fast but finite slew)
        const smoothCoeff = 1.0 - Math.exp(-dt * 5000.0);
        s[ch] += (gain - s[ch]) * smoothCoeff;

        // Very subtle saturation — SSM2164 is remarkably clean
        // THD is well below 0.1% at normal levels
        const raw = sigIn * s[ch];
        out[outPin] = softClip(raw * 0.1, 1.0) * 10.0;
      }
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(ssm2164);

export { ssm2164 };
