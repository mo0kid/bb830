import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
} from '../types';

/**
 * Diode — 2-terminal semiconductor
 *
 * Pins: [0] anode (+), [1] cathode (−)
 * Parameters:
 *   vForward: forward voltage drop (default 0.6V for silicon, 0.3V for germanium)
 *   type: 0 = silicon (1N4148), 1 = germanium (1N34A), 2 = LED, 3 = zener
 *   vZener: zener breakdown voltage (only for type 3)
 *
 * State: [0] current through diode
 */

const diode: ICModel = {
  type: 'diode',
  name: 'Diode',
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
    fidelity: Fidelity,
  ): void {
    const vForward = params['vForward'] ?? 0.6;
    const vAnode = inputs[0] ?? 0;
    const vCathode = inputs[1] ?? 0;
    const vAcross = vAnode - vCathode;

    if (fidelity === Fidelity.Block) {
      // Ideal diode: conducts above vForward, blocks otherwise
      if (vAcross >= vForward) {
        state.outputs[0] = vAnode;
        state.outputs[1] = vAnode - vForward;
        state.state[0] = (vAcross - vForward) / 100; // approximate current
      } else {
        state.outputs[0] = vAnode;
        state.outputs[1] = vCathode;
        state.state[0] = 0;
      }
    } else {
      // Behavioral: Shockley diode equation approximation
      // I = Is * (exp(V / Vt) - 1) where Vt ≈ 26mV at room temp
      const Vt = 0.026;
      const Is = 1e-12;
      const current = Is * (Math.exp(Math.min(vAcross / Vt, 40)) - 1);
      state.state[0] = current;
      state.outputs[0] = vAnode;
      state.outputs[1] = vAnode - Math.min(vAcross, vForward + 0.1);
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(diode);

export { diode };
