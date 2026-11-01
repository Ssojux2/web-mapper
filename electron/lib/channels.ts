// IPC channel names shared by the main process and the preload script.
export const IPC = {
  displays: 'displays:list',
  outputOpen: 'output:open',
  outputClose: 'output:close',
  outputToggleFullscreen: 'output:toggleFullscreen',
  outputStatus: 'output:status',
  captureSources: 'capture:sources',
  captureSelect: 'capture:select',
  captureLookup: 'capture:lookup',
  capturePermission: 'capture:permission',
  captureOpenSettings: 'capture:openSettings',
} as const;
