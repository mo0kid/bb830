import { contextBridge, ipcRenderer } from 'electron';
import type { Project } from '../shared/project-schema';

// Handle API commands directly in preload (context bridge can't pass callbacks reliably)
// Commands are queued and polled by the renderer
const commandQueue: Array<{ reqId: string; action: string; payload: any }> = [];

ipcRenderer.on('api:command', (_event, data) => {
  commandQueue.push(data);
});

const api = {
  project: {
    new: (name: string): Promise<Project> =>
      ipcRenderer.invoke('project:new', name),
    open: (): Promise<Project | null> =>
      ipcRenderer.invoke('project:open'),
    save: (project: Project, filePath?: string): Promise<string | null> =>
      ipcRenderer.invoke('project:save', project, filePath),
  },
  /** Poll for pending API commands from MCP server */
  pollApiCommands: (): Array<{ reqId: string; action: string; payload: any }> => {
    const cmds = commandQueue.splice(0);
    return cmds;
  },
  /** Send API response back to main process */
  apiResponse: (reqId: string, result: any, error?: string) => {
    ipcRenderer.send('api:response', { reqId, result, error });
  },
};

export type BB830API = typeof api;

contextBridge.exposeInMainWorld('bb830', api);
