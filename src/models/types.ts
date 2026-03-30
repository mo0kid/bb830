// ---- Fidelity Levels ----

export enum Fidelity {
  /** Transfer functions, ideal gain stages — real-time++ */
  Block = 1,
  /** Nonlinear curves from datasheets, frequency-dependent — real-time */
  Behavioral = 2,
  /** MNA solver, transistor-level models — offline */
  Component = 3,
}

// ---- Model State ----

/** Per-instance runtime state for a component model */
export interface ModelState {
  /** Internal state variables (capacitor voltages, oscillator phase, etc.) */
  state: Float64Array;
  /** Output values at each pin */
  outputs: Float64Array;
}

// ---- IC Model Interface ----

/**
 * An ICModel describes the electrical behavior of a component.
 * Each IC type (CEM3340, CEM3320, etc.) provides one of these.
 * Models support multiple fidelity levels — the engine calls
 * the appropriate process method based on the selected level.
 */
export interface ICModel {
  /** Unique type identifier matching Component.type */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /** Number of pins */
  readonly pinCount: number;

  /** Number of internal state variables */
  readonly stateSize: number;

  /** Supported fidelity levels */
  readonly supportedFidelity: Fidelity[];

  /** Create a fresh state for a new instance of this component */
  createState(): ModelState;

  /**
   * Reset state to initial conditions (e.g., zero capacitor voltages).
   * Called when simulation starts or resets.
   */
  reset(state: ModelState): void;

  /**
   * Process one sample at the given fidelity level.
   *
   * @param state   - Mutable per-instance state
   * @param inputs  - Voltage at each pin (from the netlist solver)
   * @param params  - Component parameters (resistance, capacitance, CV, etc.)
   * @param dt      - Time step in seconds (1/sampleRate)
   * @param fidelity - Which fidelity level to use
   *
   * Writes results into state.outputs[].
   */
  process(
    state: ModelState,
    inputs: Float64Array,
    params: Record<string, number>,
    dt: number,
    fidelity: Fidelity,
  ): void;

  /**
   * Get the current output voltage at a specific pin.
   * Called after process() to read results.
   */
  getOutput(state: ModelState, pinIndex: number): number;
}

// ---- Model Registry ----
// Stash on globalThis so it survives Vite HMR reloads
const _g = globalThis as any;
if (!_g.__bb830_model_registry) _g.__bb830_model_registry = new Map<string, ICModel>();
const registry: Map<string, ICModel> = _g.__bb830_model_registry;

export function registerModel(model: ICModel): void {
  registry.set(model.type, model);
}

export function getModel(type: string): ICModel | undefined {
  return registry.get(type);
}

export function getAllModels(): ICModel[] {
  return Array.from(registry.values());
}

// ---- Utility: V/Oct conversion ----

/** Convert a control voltage to frequency using 1V/octave standard.
 *  0V = base frequency (typically ~8.176 Hz for MIDI note 0, or
 *  set baseFreq to 261.63 for middle C as 0V reference) */
export function cvToFrequency(cv: number, baseFreq: number = 261.63): number {
  return baseFreq * Math.pow(2, cv);
}

/** Convert frequency to control voltage */
export function frequencyToCv(freq: number, baseFreq: number = 261.63): number {
  return Math.log2(freq / baseFreq);
}

/** Soft clipping — tanh-based saturation */
export function softClip(x: number, drive: number = 1): number {
  return Math.tanh(x * drive);
}

/** Diode clipping approximation */
export function diodeClip(x: number, threshold: number = 0.6): number {
  if (x > threshold) return threshold + (x - threshold) / (1 + (x - threshold));
  if (x < -threshold) return -threshold + (x + threshold) / (1 - (x + threshold));
  return x;
}
