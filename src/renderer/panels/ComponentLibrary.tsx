import { useUIStore } from '../stores/ui-store';
import type { ComponentDefinition, ComponentCategory } from '../../shared/netlist-types';

// Initial component library — will grow as IC models are added
const COMPONENT_LIBRARY: ComponentDefinition[] = [
  {
    type: 'CEM3340',
    name: 'CEM3340 VCO',
    category: 'vco',
    package: 'DIP16',
    description: 'Curtis voltage-controlled oscillator. Saw/tri/pulse outputs.',
    pins: [
      { index: 0, name: 'RAMP OUT', type: 'output' },
      { index: 1, name: 'GND', type: 'ground' },
      { index: 2, name: 'PULSE OUT', type: 'output' },
      { index: 3, name: 'PW IN', type: 'input' },
      { index: 4, name: 'SOFT SYNC', type: 'input' },
      { index: 5, name: 'HARD SYNC', type: 'input' },
      { index: 6, name: 'FREQ CV SUM', type: 'cv' },
      { index: 7, name: 'FREQ CV IN', type: 'cv' },
      { index: 8, name: 'TIMING CAP', type: 'bidirectional' },
      { index: 9, name: 'TIMING RES', type: 'bidirectional' },
      { index: 10, name: 'V+', type: 'power' },
      { index: 11, name: 'V-', type: 'power' },
      { index: 12, name: 'TRI OUT', type: 'output' },
      { index: 13, name: 'COMP IN', type: 'input' },
      { index: 14, name: 'SCALE TRIM', type: 'input' },
      { index: 15, name: 'SCALE IN', type: 'cv' },
    ],
    defaultParameters: {},
  },
  {
    type: 'CEM3320',
    name: 'CEM3320 VCF',
    category: 'vcf',
    package: 'DIP18',
    description: 'Curtis 4-pole voltage-controlled filter. LP/BP/HP modes.',
    pins: [
      { index: 0, name: 'SIG IN 1+', type: 'input' },
      { index: 1, name: 'SIG IN 1-', type: 'input' },
      { index: 2, name: 'SIG IN 2-', type: 'input' },
      { index: 3, name: 'SIG IN 2+', type: 'input' },
      { index: 4, name: 'FREQ CV 1', type: 'cv' },
      { index: 5, name: 'FREQ CV 2', type: 'cv' },
      { index: 6, name: 'FREQ CV 3', type: 'cv' },
      { index: 7, name: 'RESONANCE', type: 'cv' },
      { index: 8, name: 'V-', type: 'power' },
      { index: 9, name: 'GND', type: 'ground' },
      { index: 10, name: 'V+', type: 'power' },
      { index: 11, name: 'BP OUT', type: 'output' },
      { index: 12, name: 'LP OUT', type: 'output' },
      { index: 13, name: 'OUTPUT', type: 'output' },
      { index: 14, name: 'RES IN', type: 'input' },
      { index: 15, name: 'Q COMP', type: 'bidirectional' },
      { index: 16, name: 'N/C', type: 'bidirectional' },
      { index: 17, name: 'N/C', type: 'bidirectional' },
    ],
    defaultParameters: {},
  },
  {
    type: 'CEM3360',
    name: 'CEM3360 Dual VCA',
    category: 'vca',
    package: 'DIP14',
    description: 'Curtis dual voltage-controlled amplifier. Log/linear modes.',
    pins: [
      { index: 0, name: 'CV A', type: 'cv' },
      { index: 1, name: 'MODE A', type: 'input' },
      { index: 2, name: 'SIG IN A', type: 'input' },
      { index: 3, name: 'OUT A', type: 'output' },
      { index: 4, name: 'GND', type: 'ground' },
      { index: 5, name: 'V-', type: 'power' },
      { index: 6, name: 'V+', type: 'power' },
      { index: 7, name: 'OUT B', type: 'output' },
      { index: 8, name: 'SIG IN B', type: 'input' },
      { index: 9, name: 'MODE B', type: 'input' },
      { index: 10, name: 'CV B', type: 'cv' },
      { index: 11, name: 'BIAS', type: 'input' },
      { index: 12, name: 'GAIN SET', type: 'input' },
      { index: 13, name: 'REF OUT', type: 'output' },
    ],
    defaultParameters: {},
  },
  {
    type: 'SSM2040',
    name: 'SSM2040 VCF',
    category: 'vcf',
    package: 'DIP16',
    description: 'Solid State Music 4-pole low-pass filter. Prophet-5 Rev 1-2.',
    pins: [
      { index: 0, name: 'SIG IN', type: 'input' },
      { index: 1, name: 'AUDIO SUM', type: 'input' },
      { index: 2, name: 'FREQ CV 1', type: 'cv' },
      { index: 3, name: 'FREQ CV 2', type: 'cv' },
      { index: 4, name: 'FREQ CV 3', type: 'cv' },
      { index: 5, name: 'FREQ CV SUM', type: 'cv' },
      { index: 6, name: 'V-', type: 'power' },
      { index: 7, name: 'GND', type: 'ground' },
      { index: 8, name: 'V+', type: 'power' },
      { index: 9, name: 'N/C', type: 'bidirectional' },
      { index: 10, name: 'N/C', type: 'bidirectional' },
      { index: 11, name: 'RES', type: 'cv' },
      { index: 12, name: 'RES CAP', type: 'bidirectional' },
      { index: 13, name: 'POLE 4 OUT', type: 'output' },
      { index: 14, name: 'POLE 2 OUT', type: 'output' },
      { index: 15, name: 'N/C', type: 'bidirectional' },
    ],
    defaultParameters: {},
  },
  {
    type: 'SSM2044',
    name: 'SSM2044 VCF',
    category: 'vcf',
    package: 'DIP16',
    description: 'Improved 4-pole low-pass filter. Korg Mono/Poly, Polysix.',
    pins: [
      { index: 0, name: 'INPUT', type: 'input' },
      { index: 1, name: 'AUDIO SUM', type: 'input' },
      { index: 2, name: 'V-', type: 'power' },
      { index: 3, name: 'FREQ CV 1', type: 'cv' },
      { index: 4, name: 'FREQ CV SUM', type: 'cv' },
      { index: 5, name: 'FREQ CV 2', type: 'cv' },
      { index: 6, name: 'GND', type: 'ground' },
      { index: 7, name: 'V+', type: 'power' },
      { index: 8, name: 'RESONANCE', type: 'cv' },
      { index: 9, name: 'OUTPUT', type: 'output' },
      { index: 10, name: 'N/C', type: 'bidirectional' },
      { index: 11, name: 'N/C', type: 'bidirectional' },
      { index: 12, name: 'N/C', type: 'bidirectional' },
      { index: 13, name: 'N/C', type: 'bidirectional' },
      { index: 14, name: 'N/C', type: 'bidirectional' },
      { index: 15, name: 'N/C', type: 'bidirectional' },
    ],
    defaultParameters: {},
  },
  {
    type: 'SSM2164',
    name: 'SSM2164 Quad VCA',
    category: 'vca',
    package: 'DIP16',
    description: 'Quad voltage-controlled amplifier. Widely used in Eurorack.',
    pins: [
      { index: 0, name: 'IN 1', type: 'input' },
      { index: 1, name: 'CV 1', type: 'cv' },
      { index: 2, name: 'OUT 1', type: 'output' },
      { index: 3, name: 'V-', type: 'power' },
      { index: 4, name: 'OUT 2', type: 'output' },
      { index: 5, name: 'CV 2', type: 'cv' },
      { index: 6, name: 'IN 2', type: 'input' },
      { index: 7, name: 'IN 3', type: 'input' },
      { index: 8, name: 'CV 3', type: 'cv' },
      { index: 9, name: 'OUT 3', type: 'output' },
      { index: 10, name: 'V+', type: 'power' },
      { index: 11, name: 'OUT 4', type: 'output' },
      { index: 12, name: 'CV 4', type: 'cv' },
      { index: 13, name: 'IN 4', type: 'input' },
      { index: 14, name: 'GND', type: 'ground' },
      { index: 15, name: 'GND', type: 'ground' },
    ],
    defaultParameters: {},
  },
  {
    type: 'TL072',
    name: 'TL072 Dual Op-Amp',
    category: 'opamp',
    package: 'DIP8',
    description: 'Low-noise JFET dual operational amplifier.',
    pins: [
      { index: 0, name: 'OUT A', type: 'output' },
      { index: 1, name: 'IN A-', type: 'input' },
      { index: 2, name: 'IN A+', type: 'input' },
      { index: 3, name: 'V-', type: 'power' },
      { index: 4, name: 'IN B+', type: 'input' },
      { index: 5, name: 'IN B-', type: 'input' },
      { index: 6, name: 'OUT B', type: 'output' },
      { index: 7, name: 'V+', type: 'power' },
    ],
    defaultParameters: {},
  },
  {
    type: 'resistor',
    name: 'Resistor',
    category: 'resistor',
    package: 'axial',
    description: 'Through-hole resistor',
    pins: [
      { index: 0, name: '1', type: 'bidirectional' },
      { index: 1, name: '2', type: 'bidirectional' },
    ],
    defaultParameters: { resistance: 10000 },
  },
  {
    type: 'capacitor',
    name: 'Capacitor',
    category: 'capacitor',
    package: 'radial',
    description: 'Through-hole capacitor',
    pins: [
      { index: 0, name: '+', type: 'bidirectional' },
      { index: 1, name: '-', type: 'bidirectional' },
    ],
    defaultParameters: { capacitance: 0.0000001 },  // 100nF
  },
  {
    type: 'potentiometer',
    name: 'Potentiometer',
    category: 'potentiometer',
    package: 'radial',
    description: 'Variable resistor (3-terminal)',
    pins: [
      { index: 0, name: '1', type: 'bidirectional' },
      { index: 1, name: 'WIPER', type: 'bidirectional' },
      { index: 2, name: '3', type: 'bidirectional' },
    ],
    defaultParameters: { resistance: 100000, position: 0.5 },
  },
  {
    type: 'diode',
    name: '1N4148 Si Diode',
    category: 'diode',
    package: 'axial',
    description: 'Small signal silicon diode. Vf = 0.6V.',
    pins: [
      { index: 0, name: 'Anode', type: 'input' },
      { index: 1, name: 'Cathode', type: 'output' },
    ],
    defaultParameters: { vForward: 0.6 },
  },
  {
    type: 'diode',
    name: '1N34A Ge Diode',
    category: 'diode',
    package: 'axial',
    description: 'Germanium diode. Vf = 0.3V. Classic waveshaping.',
    pins: [
      { index: 0, name: 'Anode', type: 'input' },
      { index: 1, name: 'Cathode', type: 'output' },
    ],
    defaultParameters: { vForward: 0.3 },
  },
  {
    type: 'diode',
    name: 'LED',
    category: 'diode',
    package: 'radial',
    description: 'Light-emitting diode. Vf = 2.0V.',
    pins: [
      { index: 0, name: 'Anode', type: 'input' },
      { index: 1, name: 'Cathode', type: 'output' },
    ],
    defaultParameters: { vForward: 2.0 },
  },
  // ---- Transistors ----
  {
    type: 'transistor',
    name: '2N3904 NPN',
    category: 'transistor',
    package: 'radial',
    description: 'General-purpose NPN transistor. hFE ~200.',
    pins: [
      { index: 0, name: 'Base', type: 'input' },
      { index: 1, name: 'Collector', type: 'output' },
      { index: 2, name: 'Emitter', type: 'output' },
    ],
    defaultParameters: { type: 0, hfe: 200, vbe: 0.6 },
  },
  {
    type: 'transistor',
    name: '2N3906 PNP',
    category: 'transistor',
    package: 'radial',
    description: 'General-purpose PNP transistor. hFE ~200.',
    pins: [
      { index: 0, name: 'Base', type: 'input' },
      { index: 1, name: 'Collector', type: 'output' },
      { index: 2, name: 'Emitter', type: 'output' },
    ],
    defaultParameters: { type: 1, hfe: 200, vbe: 0.6 },
  },
  {
    type: 'transistor',
    name: 'BC547 NPN',
    category: 'transistor',
    package: 'radial',
    description: 'Low-noise NPN. Common in synth circuits.',
    pins: [
      { index: 0, name: 'Base', type: 'input' },
      { index: 1, name: 'Collector', type: 'output' },
      { index: 2, name: 'Emitter', type: 'output' },
    ],
    defaultParameters: { type: 0, hfe: 300, vbe: 0.6 },
  },
  {
    type: 'transistor',
    name: 'BC557 PNP',
    category: 'transistor',
    package: 'radial',
    description: 'Low-noise PNP. Complement to BC547.',
    pins: [
      { index: 0, name: 'Base', type: 'input' },
      { index: 1, name: 'Collector', type: 'output' },
      { index: 2, name: 'Emitter', type: 'output' },
    ],
    defaultParameters: { type: 1, hfe: 300, vbe: 0.6 },
  },
  {
    type: 'transistor',
    name: '2N5457 JFET',
    category: 'transistor',
    package: 'radial',
    description: 'N-channel JFET. Used in VCAs and buffers.',
    pins: [
      { index: 0, name: 'Gate', type: 'input' },
      { index: 1, name: 'Drain', type: 'output' },
      { index: 2, name: 'Source', type: 'output' },
    ],
    defaultParameters: { type: 0, hfe: 50, vbe: 0 },
  },
  // ---- Trimpots ----
  {
    type: 'potentiometer',
    name: 'Trimpot 1k',
    category: 'potentiometer',
    package: 'radial',
    description: 'Trimmer potentiometer 1kΩ',
    pins: [
      { index: 0, name: '1', type: 'bidirectional' },
      { index: 1, name: 'WIPER', type: 'bidirectional' },
      { index: 2, name: '3', type: 'bidirectional' },
    ],
    defaultParameters: { resistance: 1000, position: 0.5 },
  },
  {
    type: 'potentiometer',
    name: 'Trimpot 10k',
    category: 'potentiometer',
    package: 'radial',
    description: 'Trimmer potentiometer 10kΩ',
    pins: [
      { index: 0, name: '1', type: 'bidirectional' },
      { index: 1, name: 'WIPER', type: 'bidirectional' },
      { index: 2, name: '3', type: 'bidirectional' },
    ],
    defaultParameters: { resistance: 10000, position: 0.5 },
  },
  {
    type: 'potentiometer',
    name: 'Trimpot 100k',
    category: 'potentiometer',
    package: 'radial',
    description: 'Trimmer potentiometer 100kΩ',
    pins: [
      { index: 0, name: '1', type: 'bidirectional' },
      { index: 1, name: 'WIPER', type: 'bidirectional' },
      { index: 2, name: '3', type: 'bidirectional' },
    ],
    defaultParameters: { resistance: 100000, position: 0.5 },
  },
];

const CATEGORIES: { key: ComponentCategory; label: string }[] = [
  { key: 'vco', label: 'VCO' },
  { key: 'vcf', label: 'VCF' },
  { key: 'vca', label: 'VCA' },
  { key: 'opamp', label: 'Op-Amps' },
  { key: 'transistor', label: 'Transistors' },
  { key: 'diode', label: 'Diodes' },
  { key: 'resistor', label: 'Resistors' },
  { key: 'capacitor', label: 'Capacitors' },
  { key: 'potentiometer', label: 'Pots / Trims' },
];

export function ComponentLibrary() {
  const { selectedComponent, setSelectedComponent } = useUIStore();

  return (
    <div style={styles.panel}>
      <div style={styles.header}>Components</div>
      {CATEGORIES.map(({ key, label }) => {
        const items = COMPONENT_LIBRARY.filter(c => c.category === key);
        if (items.length === 0) return null;
        return (
          <div key={key}>
            <div style={styles.categoryLabel}>{label}</div>
            {items.map(def => (
              <button
                key={def.name}
                onClick={() =>
                  setSelectedComponent(
                    selectedComponent?.name === def.name ? null : def
                  )
                }
                style={{
                  ...styles.item,
                  ...(selectedComponent?.name === def.name ? styles.itemActive : {}),
                }}
                title={def.description}
              >
                <span style={styles.itemName}>{def.name}</span>
                <span style={styles.itemPackage}>{def.package}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 200,
    background: '#16213e',
    borderRight: '1px solid #0f3460',
    overflowY: 'auto',
    flexShrink: 0,
  },
  header: {
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#e94560',
    borderBottom: '1px solid #0f3460',
  },
  categoryLabel: {
    padding: '6px 12px 2px',
    fontSize: 10,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: '5px 12px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #0f3460',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  itemActive: {
    background: '#0f3460',
    color: '#fff',
  },
  itemName: {},
  itemPackage: {
    fontSize: 10,
    color: '#666',
  },
};

export { COMPONENT_LIBRARY };
