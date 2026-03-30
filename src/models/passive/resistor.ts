import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * Resistor — 2-terminal passive component
 *
 * Pins: [0] terminal 1, [1] terminal 2
 * Parameter: resistance (ohms)
 *
 * The resistor model is simple — it computes current flow
 * based on the voltage difference across its terminals.
 * In the context of the netlist solver, resistors contribute
 * conductance (1/R) to the MNA matrix.
 *
 * State: [0] current through resistor (for probing)
 */

const resistor: ICModel = {
  type: 'resistor',
  name: 'Resistor',
  pinCount: 2,
  stateSize: 1,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(1),
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
    const R = params['resistance'] ?? 10000;
    const v1 = inputs[0] ?? 0;
    const v2 = inputs[1] ?? 0;
    const current = (v1 - v2) / R;
    state.state[0] = current;
    state.outputs[0] = v1;
    state.outputs[1] = v2;
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(resistor);

export { resistor };
