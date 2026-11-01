import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, session, type WebPreferences } from 'electron';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DisplayInfo } from '../src/desktop/api';
import { forgetWindow, installDisplayMediaHandler, listSources, lookupSource, openScreenSettings, screenPermission, selectSource } from './capture';
import { IPC } from './lib/channels';
import { resolveAppPath } from './lib/paths';
import { broadcastStatus, closeOutput, openOutput, outputStatus, toggleOutputFullscreen } from './output-window';
import { runSmokeTest } from './smoke';

// Desktop shell around the web app. The pages are served from app://web-mapper/, a
// standard secure origin, so localStorage, IndexedDB, BroadcastChannel, the File System
// Access API and getDisplayMedia behave exactly as on the web.

const DIST = path.join(import.meta.dirname, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SMOKE = process.argv.find((a) => a.startsWith('--smoke-test'));

if (SMOKE) {
  // Fresh profile, and software WebGL on CI machines without a GPU.
  app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'web-mapper-smoke-')));
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const ORIGIN = DEV_URL ? new URL(DEV_URL).origin : 'app://web-mapper';
const pageUrl = (page: string) => `${ORIGIN}/${page}`;

const webPreferences: WebPreferences = {
  preload: path.join(import.meta.dirname, 'preload.cjs'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // The output follows the editor's clock and keeps rendering while the editor is hidden.
  backgroundThrottling: false,
  additionalArguments: SMOKE ? ['--mapper-smoke'] : [],
};

const ALLOWED_PERMISSIONS = new Set(['display-capture', 'media', 'fileSystem', 'fullscreen', 'clipboard-sanitized-write']);

let editor: BrowserWindow | null = null;

function createEditor(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Web Mapper',
    backgroundColor: '#141417',
    show: false,
    webPreferences,
  });
  w.once('ready-to-show', () => w.show());
  // Links and window.open never open app windows; the output is created over IPC.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.on('closed', () => {
    editor = null;
    closeOutput();
  });
  void w.loadURL(pageUrl('index.html'));
  return w;
}

function installMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs the Edit menu for copy/paste shortcuts in text fields.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  );
}

function registerIpc(): void {
  ipcMain.handle(IPC.displays, (): DisplayInfo[] => {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.label || `화면 ${i + 1}`,
      primary: d.id === primary.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
    }));
  });
  ipcMain.handle(IPC.outputOpen, (_e, displayId?: number) => openOutput(pageUrl('output.html'), webPreferences, displayId));
  ipcMain.handle(IPC.outputClose, () => closeOutput());
  ipcMain.handle(IPC.outputToggleFullscreen, () => toggleOutputFullscreen());
  ipcMain.handle(IPC.outputStatus, () => outputStatus());
  ipcMain.handle(IPC.captureSources, () => listSources());
  ipcMain.handle(IPC.captureSelect, (e, mediaId: string, sourceId: string) => selectSource(e.sender.id, mediaId, sourceId));
  ipcMain.handle(IPC.captureLookup, (_e, mediaId: string) => lookupSource(mediaId));
  ipcMain.handle(IPC.capturePermission, () => screenPermission());
  ipcMain.handle(IPC.captureOpenSettings, () => openScreenSettings());
}

app.on('web-contents-created', (_e, contents) => {
  const id = contents.id;
  contents.on('destroyed', () => forgetWindow(id));
  // Only our own pages: never navigate an app window elsewhere.
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
});

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const file = resolveAppPath(DIST, new URL(request.url).pathname);
    return file ? net.fetch(pathToFileURL(file).href) : new Response('Not found', { status: 404 });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  installDisplayMediaHandler();
  registerIpc();
  installMenu();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(event as 'display-added', broadcastStatus);
  }

  editor = createEditor();
  if (SMOKE) {
    const out = SMOKE.includes('=') ? SMOKE.slice(SMOKE.indexOf('=') + 1) : path.join(os.tmpdir(), 'web-mapper-smoke.json');
    app.exit(await runSmokeTest(editor, out, { pageUrl, origin: ORIGIN, webPreferences }));
  }
});

app.on('activate', () => {
  if (!editor) editor = createEditor();
});

app.on('window-all-closed', () => app.quit());
