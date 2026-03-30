import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * Capacitor — 2-terminal passive component
 *
 * Pins: [0] + terminal, [1] - terminal
 * Parameter: capacitance (farads)
 *
 * Uses trapezoidal integration for the I-V relationship:
 *   i = C * dV/dt
 *
 * State: [0] previous voltage across cap, [1] current
 */

const capacitor: ICModel = {
  type: 'capacitor',
  name: 'Capacitor',
  pinCount: 2,
  stateSize: 2,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(2),
      outputs: new Float64Array(2),
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
    _fidelity: Fidelity,
  ): void {
    const C = params['capacitance'] ?? 1e-7;  // 100nF default
    const v1 = inputs[0] ?? 0;
    const v2 = inputs[1] ?? 0;
    const vAcross = v1 - v2;
    const prevV = state.state[0];

    // Trapezoidal: i = C * (v - prevV) / dt
    const current = C * (vAcross - prevV) / dt;
    state.state[0] = vAcross;
    state.state[1] = current;

    state.outputs[0] = v1;
    state.outputs[1] = v2;
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(capacitor);

export { capacitor };
