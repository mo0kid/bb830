import { type ICModel, type ModelState, Fidelity, getModel } from '../models/types';

/**
 * SimulatorInstance — one running instance of a component model.
 * Created for each Component in the netlist.
 */
export interface SimInstance {
  componentId: string;
  model: ICModel;
  state: ModelState;
  inputs: Float64Array;
  params: Record<string, number>;
}

/**
 * SimConnection — maps a net to the pins it connects.
 * Used to propagate voltages between component outputs and inputs.
 */
export interface SimConnection {
  netId: string;
  /** Pins that drive this net (outputs) */
  drivers: Array<{ instanceIdx: number; pinIndex: number }>;
  /** Pins that read from this net (inputs) */
  readers: Array<{ instanceIdx: number; pinIndex: number }>;
}

/**
 * SimConfig — configuration for a simulation run
 */
export interface SimConfig {
  sampleRate: number;
  fidelity: Fidelity;
  /** Which nets to probe (capture output) */
  probeNets: string[];
}

/**
 * SimResult — result buffer from a simulation
 */
export interface SimResult {
  /** Probe data: netId -> Float32Array of samples */
  probes: Map<string, Float32Array>;
  sampleRate: number;
  duration: number;
}

/**
 * Simulator — the core simulation engine.
 * Manages component instances, connections, and the process loop.
 *
 * For real-time (Block/Behavioral fidelity), this runs inside
 * an AudioWorklet. For offline (Component fidelity), it runs
 * in a Worker thread.
 */
export class Simulator {
  private instances: SimInstance[] = [];
  private connections: SimConnection[] = [];
  private netVoltages: Map<string, number> = new Map();
  private fidelity: Fidelity = Fidelity.Behavioral;
  private sampleRate: number = 44100;

  /** Build the simulation graph from a serialized netlist */
  setup(
    components: Array<{
      id: string;
      type: string;
      parameters: Record<string, number>;
    }>,
    nets: Array<{
      id: string;
      connections: Array<{ componentId: string; pinIndex: number }>;
    }>,
    config: SimConfig,
  ): boolean {
    this.instances = [];
    this.connections = [];
    this.netVoltages.clear();
    this.sampleRate = config.sampleRate;
    this.fidelity = config.fidelity;

    // Create instances
    for (const comp of components) {
      const model = getModel(comp.type);
      if (!model) {
        console.warn(`No model found for component type: ${comp.type}`);
        continue;
      }

      this.instances.push({
        componentId: comp.id,
        model,
        state: model.createState(),
        inputs: new Float64Array(model.pinCount),
        params: { ...comp.parameters },
      });
    }

    // Build connection map
    for (const net of nets) {
      const conn: SimConnection = {
        netId: net.id,
        drivers: [],
        readers: [],
      };

      for (const pinRef of net.connections) {
        const instIdx = this.instances.findIndex(
          i => i.componentId === pinRef.componentId,
        );
        if (instIdx < 0) continue;

        const inst = this.instances[instIdx];
        const pinDef = inst.model.pinCount > pinRef.pinIndex ? pinRef.pinIndex : -1;
        if (pinDef < 0) continue;

        // All pins can both drive and read — the model determines behavior
        conn.drivers.push({ instanceIdx: instIdx, pinIndex: pinRef.pinIndex });
        conn.readers.push({ instanceIdx: instIdx, pinIndex: pinRef.pinIndex });
      }

      this.connections.push(conn);
      this.netVoltages.set(net.id, 0);
    }

    // Reset all instances
    for (const inst of this.instances) {
      inst.model.reset(inst.state);
    }

    return this.instances.length > 0;
  }

  /** Process a single sample for all components */
  processSample(): void {
    const dt = 1.0 / this.sampleRate;

    // Step 1: Propagate net voltages to component inputs
    for (const conn of this.connections) {
      // Net voltage is the average of all driver outputs on this net
      // (simplified — a proper MNA solver would handle this properly)
      let voltage = 0;
      let driverCount = 0;

      for (const driver of conn.drivers) {
        const inst = this.instances[driver.instanceIdx];
        const v = inst.model.getOutput(inst.state, driver.pinIndex);
        if (v !== 0) {
          voltage += v;
          driverCount++;
        }
      }

      if (driverCount > 0) {
        voltage /= driverCount;
      }

      this.netVoltages.set(conn.netId, voltage);

      // Write net voltage to all reader inputs
      for (const reader of conn.readers) {
        const inst = this.instances[reader.instanceIdx];
        inst.inputs[reader.pinIndex] = voltage;
      }
    }

    // Step 2: Process each component
    for (const inst of this.instances) {
      inst.model.process(
        inst.state,
        inst.inputs,
        inst.params,
        dt,
        this.fidelity,
      );
    }
  }

  /** Process a block of samples, capturing probe data */
  processBlock(numSamples: number, probeNets: string[]): Map<string, Float32Array> {
    const probes = new Map<string, Float32Array>();
    for (const netId of probeNets) {
      probes.set(netId, new Float32Array(numSamples));
    }

    for (let i = 0; i < numSamples; i++) {
      this.processSample();

      for (const netId of probeNets) {
        const buf = probes.get(netId)!;
        buf[i] = this.netVoltages.get(netId) ?? 0;
      }
    }

    return probes;
  }

  /** Get current voltage on a net */
  getNetVoltage(netId: string): number {
    return this.netVoltages.get(netId) ?? 0;
  }

  /** Get output buffer for AudioWorklet (stereo).
   *  Probe A → left channel, Probe B → right channel. */
  fillAudioBuffer(outputL: Float32Array, outputR: Float32Array, probeNetIdA?: string, probeNetIdB?: string): void {
    const len = outputL.length;
    for (let i = 0; i < len; i++) {
      this.processSample();

      // Probe A → left channel
      if (probeNetIdA) {
        outputL[i] = (this.netVoltages.get(probeNetIdA) ?? 0) / 5.0;
      }
      // Probe B → right channel (or duplicate A if no B)
      if (probeNetIdB) {
        outputR[i] = (this.netVoltages.get(probeNetIdB) ?? 0) / 5.0;
      } else if (probeNetIdA) {
        outputR[i] = outputL[i];
      }
    }
  }

  /** Update a component parameter at runtime */
  setParameter(componentId: string, key: string, value: number): void {
    const inst = this.instances.find(i => i.componentId === componentId);
    if (inst) {
      inst.params[key] = value;
    }
  }

  /** Set a direct voltage on a component input pin (for testing) */
  setInput(componentId: string, pinIndex: number, voltage: number): void {
    const inst = this.instances.find(i => i.componentId === componentId);
    if (inst && pinIndex < inst.inputs.length) {
      inst.inputs[pinIndex] = voltage;
    }
  }

  get instanceCount(): number {
    return this.instances.length;
  }
}
