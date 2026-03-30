import { create } from 'zustand';
import { Simulator } from '../../engine/simulator';
import { Fidelity } from '../../models/types';
// Import all models so they register themselves
import '../../models/index';

export type SimStatus = 'stopped' | 'running' | 'error';

interface SimState {
  status: SimStatus;
  fidelity: Fidelity;
  probeNetId: string | null;
  probeData: Float32Array | null;
  errorMessage: string | null;
  audioContext: AudioContext | null;
  simulator: Simulator;

  // Actions
  setFidelity: (fidelity: Fidelity) => void;
  setProbeNet: (netId: string | null) => void;
  start: (
    components: Array<{ id: string; type: string; parameters: Record<string, number> }>,
    nets: Array<{ id: string; connections: Array<{ componentId: string; pinIndex: number }> }>,
  ) => void;
  stop: () => void;
  runOffline: (
    components: Array<{ id: string; type: string; parameters: Record<string, number> }>,
    nets: Array<{ id: string; connections: Array<{ componentId: string; pinIndex: number }> }>,
    durationMs: number,
  ) => void;
  setParameter: (componentId: string, key: string, value: number) => void;
}

// Persistent simulator instance
const simulator = new Simulator();

// ScriptProcessor node reference (for real-time audio output)
let scriptNode: ScriptProcessorNode | null = null;

export const useSimStore = create<SimState>((set, get) => ({
  status: 'stopped',
  fidelity: Fidelity.Behavioral,
  probeNetId: null,
  probeData: null,
  errorMessage: null,
  audioContext: null,
  simulator,

  setFidelity: (fidelity) => set({ fidelity }),

  setProbeNet: (netId) => set({ probeNetId: netId }),

  start: (components, nets) => {
    const state = get();

    // Create or resume AudioContext
    let ctx = state.audioContext;
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 44100 });
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Setup simulator
    const ok = simulator.setup(components, nets, {
      sampleRate: ctx.sampleRate,
      fidelity: state.fidelity,
      probeNets: state.probeNetId ? [state.probeNetId] : [],
    });

    if (!ok) {
      set({ status: 'error', errorMessage: 'No valid components to simulate' });
      return;
    }

    // Stop existing node
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }

    // Use ScriptProcessorNode for audio output
    // (AudioWorklet with bundled models is Phase 2b)
    const bufferSize = 1024;
    scriptNode = ctx.createScriptProcessor(bufferSize, 0, 2);

    const probeNetId = state.probeNetId;
    const probeBuf = new Float32Array(bufferSize);

    scriptNode.onaudioprocess = (e) => {
      const outputL = e.outputBuffer.getChannelData(0);
      const outputR = e.outputBuffer.getChannelData(1);

      simulator.fillAudioBuffer(outputL, outputR, probeNetId ?? undefined);

      // Capture probe data for waveform display
      if (probeNetId) {
        probeBuf.set(outputL);
        set({ probeData: new Float32Array(probeBuf) });
      }
    };

    scriptNode.connect(ctx.destination);

    set({ status: 'running', audioContext: ctx, errorMessage: null });
  },

  stop: () => {
    if (scriptNode) {
      scriptNode.disconnect();
      scriptNode = null;
    }

    const ctx = get().audioContext;
    if (ctx) {
      ctx.suspend();
    }

    set({ status: 'stopped' });
  },

  runOffline: (components, nets, durationMs) => {
    const sampleRate = 44100;
    const numSamples = Math.ceil((durationMs / 1000) * sampleRate);
    const state = get();

    const ok = simulator.setup(components, nets, {
      sampleRate,
      fidelity: state.fidelity,
      probeNets: state.probeNetId ? [state.probeNetId] : [],
    });

    if (!ok) {
      set({ status: 'error', errorMessage: 'No valid components to simulate' });
      return;
    }

    set({ status: 'running' });

    const probeNets = state.probeNetId ? [state.probeNetId] : [];
    const probes = simulator.processBlock(numSamples, probeNets);

    if (state.probeNetId) {
      set({ probeData: probes.get(state.probeNetId) ?? null });
    }

    set({ status: 'stopped' });
  },

  setParameter: (componentId, key, value) => {
    simulator.setParameter(componentId, key, value);
  },
}));
