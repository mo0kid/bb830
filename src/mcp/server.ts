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

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
