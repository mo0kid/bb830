/**
 * BB830 Audio Worklet Processor
 *
 * Runs the circuit simulation at audio rate inside an AudioWorklet.
 * Receives netlist configuration and parameter updates via MessagePort.
 * Outputs audio to speakers and sends probe data back to the main thread.
 *
 * Messages from main thread:
 *   { type: 'setup', components, nets, config }
 *   { type: 'setParam', componentId, key, value }
 *   { type: 'setInput', componentId, pinIndex, voltage }
 *   { type: 'setProbe', netId }
 *   { type: 'stop' }
 *
 * Messages to main thread:
 *   { type: 'ready' }
 *   { type: 'probeData', netId, data: Float32Array }
 */

// NOTE: This file is designed to be loaded as a worklet module.
// The Simulator and model imports would need to be bundled into
// the worklet. For now, we inline a simplified version that
// receives pre-built model data from the main thread.

// In the real implementation, we'd use a bundled version of
// Simulator that includes all model code. For Phase 2, we use
// the main-thread Simulator via a ScriptProcessorNode fallback
// or a bundled worklet.

const WORKLET_CODE = `
class BB830Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.running = false;
    this.probeNetId = null;
    this.simulator = null;

    this.port.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'setup':
          // Simulator setup would happen here
          this.running = true;
          this.port.postMessage({ type: 'ready' });
          break;
        case 'setProbe':
          this.probeNetId = msg.netId;
          break;
        case 'stop':
          this.running = false;
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.running || !this.simulator) {
      return true;
    }

    const outputL = outputs[0]?.[0];
    const outputR = outputs[0]?.[1];

    if (outputL && outputR) {
      this.simulator.fillAudioBuffer(outputL, outputR, this.probeNetId);
    }

    return true;
  }
}

registerProcessor('bb830-processor', BB830Processor);
`;

/**
 * Create and return the worklet blob URL.
 * Used to register the AudioWorklet module.
 */
export function getWorkletUrl(): string {
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export { WORKLET_CODE };
