import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';
import type { Project } from '../shared/project-schema';
import { createEmptyProject, PROJECT_FILE_EXTENSION } from '../shared/project-schema';
import { startApiServer } from './api-server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1100,
    minWidth: 1024,
    minHeight: 900,
    title: 'bb830',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load from Vite dev server; in prod, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- IPC Handlers ----

ipcMain.handle('project:new', (_event, name: string): Project => {
  return createEmptyProject(name);
});

ipcMain.handle('project:open', async (): Promise<Project | null> => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'bb830 Project', extensions: ['bb830'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const data = await readFile(result.filePaths[0], 'utf-8');
  return JSON.parse(data) as Project;
});

ipcMain.handle('project:save', async (_event, project: Project, filePath?: string): Promise<string | null> => {
  let savePath = filePath;

  if (!savePath) {
    const result = await dialog.showSaveDialog({
      defaultPath: `${project.name}${PROJECT_FILE_EXTENSION}`,
      filters: [{ name: 'bb830 Project', extensions: ['bb830'] }],
    });

    if (result.canceled || !result.filePath) return null;
    savePath = result.filePath;
  }

  const data = JSON.stringify(project, null, 2);
  await writeFile(savePath, data, 'utf-8');
  return savePath;
});

// ---- App Lifecycle ----

app.whenReady().then(() => {
  createWindow();
  startApiServer();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
