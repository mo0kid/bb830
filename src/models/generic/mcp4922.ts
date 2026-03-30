import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * MCP4922 Dual 12-bit SPI DAC
 *
 * Microchip's dual-channel 12-bit voltage-output DAC with SPI interface.
 * Used as the Pi GPIO interface in the CMI-01A rebuild — replaces all
 * the original digital logic (4116 DRAM, AD7524, AD7533, AD558).
 *
 * In simulation, the DAC output values are set directly via parameters
 * (value_a, value_b: 0-4095). In hardware, the Pi writes these via SPI.
 *
 * Output voltage: Vout = Vref * (value / 4096)
 * With Vref = 3.3V (Pi supply), output range is 0-3.3V.
 * An op-amp stage scales this to the required analog range.
 *
 * Pin mapping (DIP-14):
 *  0: VDD          7: VSS
 *  1: NC           8: LDAC
 *  2: CS           9: SHDN_B
 *  3: SCK         10: SHDN_A
 *  4: SDI         11: VOUT_B
 *  5: NC          12: VREF_B
 *  6: VOUT_A      13: VREF_A
 *
 * Parameters:
 *   value_a: 0-4095 (12-bit DAC code for channel A)
 *   value_b: 0-4095 (12-bit DAC code for channel B)
 *   vref: reference voltage (default 3.3V)
 *
 * State: [0] channel A output, [1] channel B output, [2] phase for waveform gen
 */

const PIN_VOUT_A = 6;
const PIN_VOUT_B = 11;

const mcp4922: ICModel = {
  type: 'MCP4922',
  name: 'MCP4922 Dual DAC',
  pinCount: 14,
  stateSize: 3,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(3),
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

    const vref = params['vref'] ?? 3.3;

    // In simulation mode, the DAC can operate in two ways:
    // 1. Static: value_a/value_b set directly (0-4095)
    // 2. Waveform: freq parameter generates a test waveform (saw) on channel A
    //    This simulates what the Pi would do — play back samples at pitch rate

    const freq = params['freq'] ?? 0;

    // Output amplitude: in simulation, model the full DAC+buffer chain
    // Real hardware: 0-3.3V DAC → op-amp scaler → ±5V audio
    const amplitude = params['amplitude'] ?? 5.0;

    if (freq > 0) {
      // Waveform generation mode — simulate Pi sample playback
      s[2] += freq * dt;
      if (s[2] >= 1.0) s[2] -= 1.0;

      // Bipolar sawtooth: ±amplitude (simulates DAC + buffer output)
      s[0] = (s[2] * 2.0 - 1.0) * amplitude;
    } else {
      // Static value mode — scale to bipolar range
      const valueA = Math.max(0, Math.min(4095, params['value_a'] ?? 2048));
      s[0] = ((valueA / 2048) - 1.0) * amplitude;
    }

    const valueB = Math.max(0, Math.min(4095, params['value_b'] ?? 2048));
    s[1] = ((valueB / 2048) - 1.0) * amplitude;

    // DAC settling: 4.5µs typical, modeled as simple lowpass
    if (fidelity === Fidelity.Behavioral) {
      const settle = 1.0 - Math.exp(-2 * Math.PI * 220000 * dt); // ~220kHz bandwidth
      out[PIN_VOUT_A] += settle * (s[0] - out[PIN_VOUT_A]);
      out[PIN_VOUT_B] += settle * (s[1] - out[PIN_VOUT_B]);
    } else {
      out[PIN_VOUT_A] = s[0];
      out[PIN_VOUT_B] = s[1];
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(mcp4922);

export { mcp4922 };
