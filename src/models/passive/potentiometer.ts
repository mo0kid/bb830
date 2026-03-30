import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * Potentiometer — 3-terminal variable resistor
 *
 * Pins: [0] terminal 1, [1] wiper, [2] terminal 3
 * Parameters:
 *   resistance: total resistance in ohms
 *   position: wiper position 0.0 (fully CCW) to 1.0 (fully CW)
 *
 * Acts as a voltage divider: wiper voltage is interpolated
 * between terminal 1 and terminal 3 based on position.
 *
 * State: [0] wiper voltage
 */

const potentiometer: ICModel = {
  type: 'potentiometer',
  name: 'Potentiometer',
  pinCount: 3,
  stateSize: 1,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(1),
      outputs: new Float64Array(3),
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
    _dt: number,
    _fidelity: Fidelity,
  ): void {
    const position = Math.max(0, Math.min(1, params['position'] ?? 0.5));
    const v1 = inputs[0] ?? 0;
    const v3 = inputs[2] ?? 0;

    // Wiper outputs voltage between terminal 1 and 3
    const wiperV = v1 + (v3 - v1) * position;
    state.state[0] = wiperV;

    state.outputs[0] = v1;
    state.outputs[1] = wiperV;
    state.outputs[2] = v3;
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(potentiometer);

export { potentiometer };
