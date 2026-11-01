import { BrowserWindow, screen, type WebPreferences } from 'electron';
import type { DesktopOutputStatus } from '../src/desktop/api';
import { IPC } from './lib/channels';
import { pickDisplay } from './lib/displays';

// The projector window: frameless, black and fullscreen on the chosen display. Created by
// the main process (not window.open), so it carries no browser UI and no sharing bar.

let win: BrowserWindow | null = null;
let displayId: number | undefined;

export function outputWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function isFullscreen(w: BrowserWindow): boolean {
  return process.platform === 'darwin' ? w.isSimpleFullScreen() || w.isFullScreen() : w.isFullScreen();
}

function setFullscreen(w: BrowserWindow, on: boolean): void {
  // Simple fullscreen on macOS skips the Spaces animation and covers the menu bar.
  if (process.platform === 'darwin') w.setSimpleFullScreen(on);
  else w.setFullScreen(on);
}

export function outputStatus(): DesktopOutputStatus {
  const w = outputWindow();
  if (!w) return { open: false, fullscreen: false, width: 0, height: 0 };
  const display = screen.getDisplayMatching(w.getBounds());
  return {
    open: true,
    displayId: display.id,
    fullscreen: isFullscreen(w),
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

/** Tells every window (the editor shows it, the output hides its hint) where the output stands. */
export function broadcastStatus(): void {
  const status = outputStatus();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.outputStatus, status);
}

export async function openOutput(url: string, webPreferences: WebPreferences, requested?: number): Promise<void> {
  const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), requested ?? displayId);
  displayId = display.id;
  const existing = outputWindow();
  if (existing) {
    // Moving a fullscreen window between displays only works out of fullscreen.
    if (isFullscreen(existing)) setFullscreen(existing, false);
    existing.setBounds(display.bounds);
    setFullscreen(existing, true);
    existing.show();
    existing.focus();
    broadcastStatus();
    return;
  }
  const w = new BrowserWindow({
    ...display.bounds,
    title: 'Web Mapper Output',
    frame: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences,
  });
  win = w;
  w.removeMenu();
  w.once('ready-to-show', () => {
    w.show();
    setFullscreen(w, true);
    broadcastStatus();
  });
  for (const event of ['enter-full-screen', 'leave-full-screen', 'moved', 'resize'] as const) {
    w.on(event as 'resize', broadcastStatus);
  }
  w.on('closed', () => {
    if (win === w) win = null;
    broadcastStatus();
  });
  await w.loadURL(url);
}

export function closeOutput(): void {
  outputWindow()?.close();
}

export function toggleOutputFullscreen(): void {
  const w = outputWindow();
  if (!w) return;
  setFullscreen(w, !isFullscreen(w));
  broadcastStatus();
}
