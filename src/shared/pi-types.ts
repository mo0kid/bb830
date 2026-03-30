// Raspberry Pi GPIO / DAC / ADC mapping types

export type PiConnectionType = 'websocket' | 'serial';

export interface PiConnectionConfig {
  type: PiConnectionType;
  address: string;          // IP:port for websocket, /dev/ttyUSB0 for serial
}

export type PiPinFunction = 'gpio' | 'spi' | 'i2c' | 'pwm' | 'dac' | 'adc';

export interface PiPinMapping {
  netId: string;            // Which circuit net
  piPin: number;            // BCM pin number
  function: PiPinFunction;
  direction: 'input' | 'output';
  channel?: number;         // DAC/ADC channel number
}

export interface PiMapping {
  connection: PiConnectionConfig;
  pins: PiPinMapping[];
  dacChip: 'MCP4922' | 'MCP4822' | 'MCP4725';
  adcChip: 'MCP3008' | 'MCP3208' | 'ADS1115';
  sampleRate: number;       // Hz, for ADC streaming
}

export interface PiStatus {
  connected: boolean;
  connectionType?: PiConnectionType;
  hostname?: string;
  gpioState: Record<number, boolean>;
  dacValues: Record<number, number>;   // Channel -> voltage
  adcValues: Record<number, number>;   // Channel -> voltage
}
