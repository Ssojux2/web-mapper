// IPC channel names shared by the main process and the preload script.
export const IPC = {
  displays: 'displays:list',
  outputOpen: 'output:open',
  outputClose: 'output:close',
  outputSetFullscreen: 'output:setFullscreen',
  outputStatus: 'output:status',
  captureSources: 'capture:sources',
  captureSelect: 'capture:select',
  captureArm: 'capture:arm',
  captureLookup: 'capture:lookup',
  captureChanged: 'capture:changed',
  capturePermission: 'capture:permission',
  captureOpenSettings: 'capture:openSettings',
} as const;
