import {
  type ICModel,
  type ModelState,
  Fidelity,
  registerModel,
  softClip,
} from '../types';

/**
 * BJT Transistor — 3-terminal semiconductor
 *
 * Pins: [0] Base, [1] Collector, [2] Emitter
 * Parameters:
 *   type: 0 = NPN, 1 = PNP
 *   hfe: current gain (default 200)
 *   vbe: base-emitter forward voltage (default 0.6V)
 *
 * State: [0] collector current, [1] base current
 */

const transistor: ICModel = {
  type: 'transistor',
  name: 'Transistor',
  pinCount: 3,
  stateSize: 2,
  supportedFidelity: [Fidelity.Block, Fidelity.Behavioral],

  createState(): ModelState {
    return {
      state: new Float64Array(2),
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
    dt: number,
    fidelity: Fidelity,
  ): void {
    const isNPN = (params['type'] ?? 0) === 0;
    const hfe = params['hfe'] ?? 200;
    const vbe = params['vbe'] ?? 0.6;
    const vBase = inputs[0] ?? 0;
    const vCollector = inputs[1] ?? 0;
    const vEmitter = inputs[2] ?? 0;

    const vBE = isNPN ? vBase - vEmitter : vEmitter - vBase;

    if (fidelity === Fidelity.Block) {
      if (vBE >= vbe) {
        // Active region: Ic = hfe * Ib
        const ib = (vBE - vbe) / 1000; // simplified
        const ic = hfe * ib;
        state.state[0] = ic;
        state.state[1] = ib;
        state.outputs[0] = vBase;
        state.outputs[1] = isNPN ? vCollector - ic * 100 : vCollector + ic * 100;
        state.outputs[2] = vEmitter;
      } else {
        // Cutoff
        state.state[0] = 0;
        state.state[1] = 0;
        state.outputs[0] = vBase;
        state.outputs[1] = vCollector;
        state.outputs[2] = vEmitter;
      }
    } else {
      // Behavioral: Ebers-Moll simplified
      const Vt = 0.026;
      const Is = 1e-14;
      const ib = Is * (Math.exp(Math.min(vBE / Vt, 40)) - 1);
      const ic = hfe * ib;

      // Smooth saturation
      const icLimited = softClip(ic * 0.01, 1.0) * 100;
      state.state[0] = icLimited;
      state.state[1] = ib;
      state.outputs[0] = vBase;
      state.outputs[1] = vCollector;
      state.outputs[2] = vEmitter;
    }
  },

  getOutput(state: ModelState, pinIndex: number): number {
    return state.outputs[pinIndex] ?? 0;
  },
};

registerModel(transistor);

export { transistor };
