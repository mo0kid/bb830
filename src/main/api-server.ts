/**
 * Local HTTP API server for MCP ↔ Electron communication.
 * Runs on port 23340 (CEM3340!). The MCP server sends commands here,
 * which are forwarded to the renderer via IPC.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { BrowserWindow, ipcMain } from 'electron';

const API_PORT = 23340;

let pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

let requestCounter = 0;

/**
 * Send a command to the renderer and wait for the response.
 */
function sendToRenderer(action: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      reject(new Error('No window available'));
      return;
    }

    const reqId = `api-${++requestCounter}`;
    const timeout = setTimeout(() => {
      pendingRequests.delete(reqId);
      reject(new Error('Request timed out'));
    }, 10000);

    pendingRequests.set(reqId, { resolve, timeout });
    win.webContents.send('api:command', { reqId, action, payload });
  });
}

// Renderer responds to commands via this IPC channel
ipcMain.on('api:response', (_event, { reqId, result, error }) => {
  const pending = pendingRequests.get(reqId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(reqId);
  pending.resolve(error ? { error } : result);
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

export function startApiServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. POST to /api' }));
      return;
    }

    try {
      const body = await readBody(req);
      const { action, payload } = JSON.parse(body);

      if (!action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "action" field' }));
        return;
      }

      const result = await sendToRenderer(action, payload ?? {});

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(API_PORT, '127.0.0.1', () => {
    console.log(`bb830 API server listening on http://127.0.0.1:${API_PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`bb830 API port ${API_PORT} in use, skipping API server`);
    } else {
      console.error('API server error:', err);
    }
  });
}
