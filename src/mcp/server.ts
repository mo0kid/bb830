#!/usr/bin/env node
/**
 * bb830 MCP Server
 *
 * Connects to the running bb830 Electron app via local HTTP API (port 23340)
 * to manipulate circuits live. Falls back to file-based mode if app isn't running.
 *
 * Register in .mcp.json:
 *   { "mcpServers": { "bb830": { "command": "npx", "args": ["tsx", "src/mcp/server.ts"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LayoutEngine } from './layout-engine';

const API_URL = 'http://127.0.0.1:23340/api';

/** Send a command to the running Electron app */
async function sendCommand(action: string, payload: any = {}): Promise<any> {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });
    return await res.json();
  } catch {
    return { error: 'bb830 app is not running. Start it with "npm run dev" first.' };
  }
}

function resultText(data: any): string {
  if (data?.error) return `Error: ${data.error}`;
  return JSON.stringify(data, null, 2);
}

// ---- MCP Server ----

const server = new McpServer({ name: 'bb830', version: '0.1.0' });

server.tool('bb830_place_component', 'Place a component on the breadboard (live in app)', {
  type: z.string().describe('Component type: CEM3340, CEM3320, CEM3360, TL072, resistor, capacitor, diode, transistor, potentiometer'),
  label: z.string().optional().describe('Component label, e.g. "U2", "R15"'),
  boardId: z.string().optional().describe('Board ID (default: current board)'),
  row: z.number().describe('Row number (1-63) for pin 1'),
  col: z.string().describe('Column (a-j) for pin 1. DIP ICs always straddle e-f.'),
  row2: z.number().optional().describe('Row for pin 2 (required for resistor, capacitor, diode)'),
  col2: z.string().optional().describe('Column for pin 2'),
  parameters: z.record(z.string(), z.number()).optional().describe('e.g. { "resistance": 10000 }'),
}, async ({ type, label, boardId, row, col, row2, col2, parameters }) => {
  const result = await sendCommand('place_component', { type, label, boardId, row, col, row2, col2, parameters });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_wire', 'Add a wire between two holes (live in app)', {
  boardId: z.string().optional().describe('Board ID (default: current board)'),
  fromRow: z.number().describe('Start row (1-63)'),
  fromCol: z.string().describe('Start column (a-j or +L/-L/+R/-R for rail)'),
  toRow: z.number().describe('End row (1-63)'),
  toCol: z.string().describe('End column (a-j or +L/-L/+R/-R for rail)'),
  color: z.string().optional().describe('Wire color: red, black, blue, green, yellow, orange, white, purple'),
}, async ({ boardId, fromRow, fromCol, toRow, toCol, color }) => {
  const result = await sendCommand('wire', { boardId, fromRow, fromCol, toRow, toCol, color });
  // Register wire endpoints with layout engine
  if (!fromCol.includes('L') && !fromCol.includes('R')) layout.markOccupied(fromRow, fromCol, 'wire');
  if (!toCol.includes('L') && !toCol.includes('R')) layout.markOccupied(toRow, toCol, 'wire');
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_remove', 'Remove a component or wire by ID', {
  id: z.string().describe('Component or wire ID'),
}, async ({ id }) => {
  const result = await sendCommand('remove', { id });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_set_parameter', 'Set a component parameter value', {
  componentId: z.string(),
  key: z.string().describe('Parameter name'),
  value: z.number(),
}, async ({ componentId, key, value }) => {
  const result = await sendCommand('set_parameter', { componentId, key, value });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_add_board', 'Add a new board (max 6)', {
  label: z.string().describe('Board label, e.g. "VCO", "VCF"'),
}, async ({ label }) => {
  const result = await sendCommand('add_board', { label });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_set_current_board', 'Switch to a board', {
  boardId: z.string(),
}, async ({ boardId }) => {
  const result = await sendCommand('set_current_board', { boardId });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_new_project', 'Create a new empty project', {
  name: z.string().optional().describe('Project name'),
}, async ({ name }) => {
  const result = await sendCommand('new_project', { name });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_update_board_label', 'Rename a board', {
  boardId: z.string(),
  label: z.string(),
}, async ({ boardId, label }) => {
  const result = await sendCommand('update_board_label', { boardId, label });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_get_netlist', 'Get current circuit state', {}, async () => {
  const result = await sendCommand('get_netlist');
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_get_board_state', 'Get detailed board state', {
  boardId: z.string().optional(),
}, async ({ boardId }) => {
  const result = await sendCommand('get_board_state', { boardId });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_list_components', 'List available component types', {}, async () => {
  const result = await sendCommand('list_components');
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_add_net', 'Create a named net connecting component pins', {
  name: z.string().describe('Net name, e.g. "SAW_OUT", "CV_IN"'),
  connections: z.array(z.object({
    componentId: z.string(),
    pinIndex: z.number(),
  })).describe('Array of { componentId, pinIndex } to connect'),
}, async ({ name, connections }) => {
  const result = await sendCommand('add_net', { name, connections });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_run_sim', 'Start the circuit simulation (live audio output)', {
  probeNetId: z.string().optional().describe('Net ID to probe (hear/see waveform)'),
  fidelity: z.number().optional().describe('1=Block, 2=Behavioral (default)'),
}, async ({ probeNetId, fidelity }) => {
  const result = await sendCommand('run_sim', { probeNetId, fidelity });
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_stop_sim', 'Stop the simulation', {}, async () => {
  const result = await sendCommand('stop_sim', {});
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

server.tool('bb830_get_nets', 'List all nets', {}, async () => {
  const result = await sendCommand('get_nets', {});
  return { content: [{ type: 'text' as const, text: resultText(result) }] };
});

// ---- Smart Layout ----

// Pin definitions for auto-layout
const IC_PINS: Record<string, Array<{ index: number; name: string }>> = {
  CEM3340: [
    { index: 0, name: 'RAMP OUT' }, { index: 1, name: 'GND' }, { index: 2, name: 'PULSE OUT' },
    { index: 3, name: 'PW IN' }, { index: 4, name: 'SOFT SYNC' }, { index: 5, name: 'HARD SYNC' },
    { index: 6, name: 'FREQ CV SUM' }, { index: 7, name: 'FREQ CV IN' }, { index: 8, name: 'TIMING CAP' },
    { index: 9, name: 'TIMING RES' }, { index: 10, name: 'V+' }, { index: 11, name: 'V-' },
    { index: 12, name: 'TRI OUT' }, { index: 13, name: 'COMP IN' }, { index: 14, name: 'SCALE TRIM' },
    { index: 15, name: 'SCALE IN' },
  ],
  CEM3320: [
    { index: 0, name: 'SIG IN 1+' }, { index: 1, name: 'SIG IN 1-' }, { index: 2, name: 'SIG IN 2-' },
    { index: 3, name: 'SIG IN 2+' }, { index: 4, name: 'FREQ CV 1' }, { index: 5, name: 'FREQ CV 2' },
    { index: 6, name: 'FREQ CV 3' }, { index: 7, name: 'RESONANCE' }, { index: 8, name: 'V-' },
    { index: 9, name: 'GND' }, { index: 10, name: 'V+' }, { index: 11, name: 'BP OUT' },
    { index: 12, name: 'LP OUT' }, { index: 13, name: 'OUTPUT' }, { index: 14, name: 'RES IN' },
    { index: 15, name: 'Q COMP' }, { index: 16, name: 'N/C' }, { index: 17, name: 'N/C' },
  ],
  TL072: [
    { index: 0, name: 'OUT A' }, { index: 1, name: 'IN A-' }, { index: 2, name: 'IN A+' },
    { index: 3, name: 'V-' }, { index: 4, name: 'IN B+' }, { index: 5, name: 'IN B-' },
    { index: 6, name: 'OUT B' }, { index: 7, name: 'V+' },
  ],
};

const IC_PIN_COUNTS: Record<string, number> = {
  CEM3340: 16, CEM3320: 18, CEM3360: 14, SSM2040: 16, SSM2044: 16, SSM2164: 16, TL072: 8,
};

let layout = new LayoutEngine();

server.tool('bb830_auto_ic', 'Smart-place a DIP IC with automatic positioning and power wiring', {
  type: z.string().describe('IC type: CEM3340, CEM3320, CEM3360, TL072, etc.'),
  label: z.string().describe('Label, e.g. "U1"'),
  row: z.number().optional().describe('Preferred start row (auto-found if omitted)'),
  wirePower: z.boolean().optional().describe('Auto-wire V+ and V- to rails (default true)'),
  wireGnd: z.boolean().optional().describe('Auto-wire GND pin to rail (default true)'),
}, async ({ type, label, row, wirePower, wireGnd }) => {
  const pinCount = IC_PIN_COUNTS[type];
  if (!pinCount) return { content: [{ type: 'text' as const, text: `Unknown IC type: ${type}` }] };

  const startRow = row ?? layout.findFreeICRow(pinCount);
  const pinsPerSide = pinCount / 2;

  // Place the IC
  const result = await sendCommand('place_component', { type, label, row: startRow, col: 'e' });
  if (result?.error) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }] };

  layout.registerIC(result.id, label, type, startRow, pinCount);

  const wires: string[] = [];

  // Helper: find a free column on a row for a power wire
  function freeCol(row: number, side: 'left' | 'right'): string {
    const options = side === 'left' ? ['d', 'c', 'b', 'a'] : ['g', 'h', 'i', 'j'];
    for (const c of options) { if (layout.isFree(row, c)) return c; }
    return options[0]; // fallback
  }

  // Auto-wire power pins
  const pins = IC_PINS[type];
  if (pins && wirePower !== false) {
    for (const pin of pins) {
      const pinInfo = layout.getICPinRow(label, pin.index);
      if (!pinInfo) continue;

      if (pin.name === 'V+') {
        const railCol = pinInfo.side === 'left' ? '+L' : '+R';
        const wireCol = freeCol(pinInfo.row, pinInfo.side);
        await sendCommand('wire', { fromRow: pinInfo.row, fromCol: wireCol, toRow: pinInfo.row, toCol: railCol, color: 'red' });
        layout.markOccupied(pinInfo.row, wireCol, 'wire');
        wires.push(`V+ → ${railCol} at row ${pinInfo.row}`);
      } else if (pin.name === 'V-') {
        const railCol = pinInfo.side === 'left' ? '-L' : '-R';
        const wireCol = freeCol(pinInfo.row, pinInfo.side);
        await sendCommand('wire', { fromRow: pinInfo.row, fromCol: wireCol, toRow: pinInfo.row, toCol: railCol, color: 'blue' });
        layout.markOccupied(pinInfo.row, wireCol, 'wire');
        wires.push(`V- → ${railCol} at row ${pinInfo.row}`);
      }
    }
  }

  if (pins && wireGnd !== false) {
    for (const pin of pins) {
      if (pin.name !== 'GND') continue;
      const pinInfo = layout.getICPinRow(label, pin.index);
      if (!pinInfo) continue;
      const railCol = pinInfo.side === 'left' ? '-L' : '-R';
      const wireCol = freeCol(pinInfo.row, pinInfo.side);
      await sendCommand('wire', { fromRow: pinInfo.row, fromCol: wireCol, toRow: pinInfo.row, toCol: railCol, color: 'black' });
      layout.markOccupied(pinInfo.row, wireCol, 'wire');
      wires.push(`GND → ${railCol} at row ${pinInfo.row}`);
    }
  }

  const summary = `Placed ${label} (${type}) at row ${startRow}, pins span rows ${startRow}-${startRow + pinsPerSide - 1}. ${wires.length > 0 ? 'Wired: ' + wires.join(', ') : ''}`;
  return { content: [{ type: 'text' as const, text: summary }] };
});

server.tool('bb830_auto_passive', 'Smart-place a passive component connected to an IC pin', {
  type: z.string().describe('Component type: resistor, capacitor, diode'),
  label: z.string().describe('Label, e.g. "R1", "C1"'),
  icLabel: z.string().describe('IC label to connect to, e.g. "U1"'),
  pinIndex: z.number().optional().describe('Pin index (0-based) on the IC'),
  pinName: z.string().optional().describe('Pin name (alternative to pinIndex), e.g. "FREQ CV IN"'),
  otherEnd: z.string().optional().describe('"vcc", "gnd", or "free" — where the other pin goes (default: free)'),
  parameters: z.record(z.string(), z.number()).optional().describe('e.g. { "resistance": 100000 }'),
}, async ({ type, label, icLabel, pinIndex, pinName, otherEnd, parameters }) => {
  // Resolve pin
  let resolvedPinIndex = pinIndex;
  if (resolvedPinIndex == null && pinName) {
    const ic = layout['ics'].find((i: any) => i.label === icLabel);
    if (!ic) return { content: [{ type: 'text' as const, text: `IC "${icLabel}" not found in layout` }] };
    const pins = IC_PINS[ic.type];
    if (pins) {
      const pin = pins.find(p => p.name.toUpperCase().includes(pinName.toUpperCase()));
      if (pin) resolvedPinIndex = pin.index;
    }
  }
  if (resolvedPinIndex == null) return { content: [{ type: 'text' as const, text: 'Must specify pinIndex or pinName' }] };

  const placement = layout.placePassiveNearPin(icLabel, resolvedPinIndex, (otherEnd as any) ?? 'free');
  if (!placement) return { content: [{ type: 'text' as const, text: 'Could not find free space near the pin' }] };

  const result = await sendCommand('place_component', {
    type, label,
    row: placement.row, col: placement.col,
    row2: placement.row2, col2: placement.col2,
    parameters,
  });
  if (result?.error) return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }] };

  const wires: string[] = [];

  // Wire the other end to a rail if specified
  if (otherEnd === 'vcc' || otherEnd === 'gnd') {
    // Determine which end is farther from the IC pin (that's the rail end)
    const pinInfo = layout.getICPinRow(icLabel, resolvedPinIndex);
    const railEnd = pinInfo && Math.abs(placement.row - pinInfo.row) < Math.abs(placement.row2 - pinInfo.row)
      ? { row: placement.row2, col: placement.col2 }
      : { row: placement.row, col: placement.col };

    const wire = layout.wireToRail(railEnd.row, railEnd.col, otherEnd);
    await sendCommand('wire', wire);
    layout.markOccupied(railEnd.row, railEnd.col, 'wire');
    wires.push(`${otherEnd.toUpperCase()} rail at row ${railEnd.row}`);
  }

  return { content: [{ type: 'text' as const, text: `Placed ${label} (${type}) at ${placement.col}${placement.row}-${placement.col2}${placement.row2}. ${wires.length > 0 ? 'Wired: ' + wires.join(', ') : ''}` }] };
});

server.tool('bb830_auto_wire', 'Smart-wire between an IC pin and a rail or another IC pin', {
  fromIC: z.string().describe('Source IC label, e.g. "U1"'),
  fromPin: z.string().describe('Source pin name, e.g. "RAMP OUT"'),
  toIC: z.string().optional().describe('Destination IC label (omit for rail)'),
  toPin: z.string().optional().describe('Destination pin name'),
  toRail: z.string().optional().describe('"vcc" or "gnd" — wire to power rail instead of IC'),
  color: z.string().optional().describe('Wire color (default: auto)'),
}, async ({ fromIC, fromPin, toIC, toPin, toRail, color }) => {
  // Resolve source
  const srcIC = layout['ics'].find((i: any) => i.label === fromIC);
  if (!srcIC) return { content: [{ type: 'text' as const, text: `IC "${fromIC}" not found` }] };
  const srcPins = IC_PINS[srcIC.type];
  if (!srcPins) return { content: [{ type: 'text' as const, text: `No pin defs for ${srcIC.type}` }] };
  const srcPin = srcPins.find(p => p.name.toUpperCase().includes(fromPin.toUpperCase()));
  if (!srcPin) return { content: [{ type: 'text' as const, text: `Pin "${fromPin}" not found on ${fromIC}` }] };

  const srcInfo = layout.getICPinRow(fromIC, srcPin.index);
  if (!srcInfo) return { content: [{ type: 'text' as const, text: 'Could not resolve source pin position' }] };

  const fromCol = srcInfo.side === 'left' ? 'd' : 'g';

  if (toRail) {
    const wire = layout.wireToRail(srcInfo.row, fromCol, toRail as 'vcc' | 'gnd');
    wire.color = color ?? wire.color;
    await sendCommand('wire', wire);
    layout.markOccupied(srcInfo.row, fromCol, 'wire');
    return { content: [{ type: 'text' as const, text: `Wired ${fromIC}.${fromPin} → ${toRail.toUpperCase()} rail at row ${srcInfo.row}` }] };
  }

  if (toIC && toPin) {
    const dstICInfo = layout['ics'].find((i: any) => i.label === toIC);
    if (!dstICInfo) return { content: [{ type: 'text' as const, text: `IC "${toIC}" not found` }] };
    const dstPins = IC_PINS[dstICInfo.type];
    if (!dstPins) return { content: [{ type: 'text' as const, text: `No pin defs for ${dstICInfo.type}` }] };
    const dstPin = dstPins.find(p => p.name.toUpperCase().includes(toPin.toUpperCase()));
    if (!dstPin) return { content: [{ type: 'text' as const, text: `Pin "${toPin}" not found on ${toIC}` }] };

    const dstInfo = layout.getICPinRow(toIC, dstPin.index);
    if (!dstInfo) return { content: [{ type: 'text' as const, text: 'Could not resolve destination pin' }] };

    const toCol = dstInfo.side === 'left' ? 'd' : 'g';
    const wireColor = color ?? 'orange';
    await sendCommand('wire', { fromRow: srcInfo.row, fromCol, toRow: dstInfo.row, toCol, color: wireColor });
    return { content: [{ type: 'text' as const, text: `Wired ${fromIC}.${fromPin} (row ${srcInfo.row}) → ${toIC}.${toPin} (row ${dstInfo.row})` }] };
  }

  return { content: [{ type: 'text' as const, text: 'Must specify toIC+toPin or toRail' }] };
});

server.tool('bb830_reset_layout', 'Reset the layout engine state (call when starting a new circuit)', {}, async () => {
  layout = new LayoutEngine();
  return { content: [{ type: 'text' as const, text: 'Layout engine reset' }] };
});

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
