// ---- Pin & Connection References ----

export interface PinRef {
  componentId: string;
  pinIndex: number;
}

export interface Pin {
  index: number;
  name: string;           // e.g. 'IN1', 'OUT', 'VCC', 'GND', 'CV'
  type: PinType;
}

export type PinType =
  | 'input'
  | 'output'
  | 'power'
  | 'ground'
  | 'cv'
  | 'bidirectional';

// ---- Component ----

export type PackageType = 'DIP8' | 'DIP14' | 'DIP16' | 'DIP18' | 'DIP24' | 'axial' | 'radial';

export interface Component {
  id: string;
  type: string;           // 'CEM3320' | 'resistor' | 'TL072' | 'CEM3340' ...
  label?: string;         // User-assigned label, e.g. 'U1', 'R3'
  package: PackageType;
  pins: Pin[];
  parameters: Record<string, number>;   // R value in ohms, C in farads, etc.
}

// ---- Net (electrical connection) ----

export interface Net {
  id: string;
  name?: string;          // 'CV_IN', 'AUDIO_OUT', 'VCC', 'GND'
  connections: PinRef[];
}

// ---- Netlist ----

export interface Netlist {
  components: Component[];
  nets: Net[];
}

// ---- Component Definition (library entry) ----

export interface ComponentDefinition {
  type: string;
  name: string;           // Human-readable: 'CEM3320 VCF'
  category: ComponentCategory;
  package: PackageType;
  pins: Pin[];
  defaultParameters: Record<string, number>;
  description: string;
}

export type ComponentCategory =
  | 'vco'
  | 'vcf'
  | 'vca'
  | 'opamp'
  | 'ota'
  | 'transistor'
  | 'diode'
  | 'resistor'
  | 'capacitor'
  | 'potentiometer';
