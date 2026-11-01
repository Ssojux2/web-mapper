import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopOutputStatus, MapperDesktopApi } from '../src/desktop/api';
import { IPC } from './lib/channels';

// Runs sandboxed in every app window and exposes the small `window.mapperDesktop` API.

const api: MapperDesktopApi = {
  platform: process.platform,
  smoke: process.argv.includes('--mapper-smoke'),
  displays: () => ipcRenderer.invoke(IPC.displays),
  output: {
    open: (displayId) => ipcRenderer.invoke(IPC.outputOpen, displayId),
    close: () => ipcRenderer.invoke(IPC.outputClose),
    toggleFullscreen: () => ipcRenderer.invoke(IPC.outputToggleFullscreen),
    status: () => ipcRenderer.invoke(IPC.outputStatus),
    onStatus(cb) {
      const listener = (_e: Electron.IpcRendererEvent, status: DesktopOutputStatus) => cb(status);
      ipcRenderer.on(IPC.outputStatus, listener);
      return () => ipcRenderer.off(IPC.outputStatus, listener);
    },
  },
  capture: {
    sources: () => ipcRenderer.invoke(IPC.captureSources),
    select: (mediaId, sourceId) => ipcRenderer.invoke(IPC.captureSelect, mediaId, sourceId),
    lookup: (mediaId) => ipcRenderer.invoke(IPC.captureLookup, mediaId),
    permission: () => ipcRenderer.invoke(IPC.capturePermission),
    openSettings: () => ipcRenderer.invoke(IPC.captureOpenSettings),
  },
};

contextBridge.exposeInMainWorld('mapperDesktop', api);

