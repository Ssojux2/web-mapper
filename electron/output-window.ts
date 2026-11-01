import { BrowserWindow, screen, type Display, type Rectangle, type WebPreferences } from 'electron';
import type { DesktopOutputStatus } from '../src/desktop/api';
import { IPC } from './lib/channels';
import { pickDisplay, windowedBounds } from './lib/displays';

// The projector window. It is a normal window the user can move and resize, and goes
// fullscreen on whatever display it is on (F / double-click, or from the editor). It is
// created by the main process, not window.open, so it carries no browser UI and no
// sharing bar. When a display changes resolution or disappears, a fullscreen output is
// refitted to the display it ends up on.

let win: BrowserWindow | null = null;
let requestedDisplay: number | undefined;

export function outputWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function isFullscreen(w: BrowserWindow): boolean {
  return process.platform === 'darwin' ? w.isSimpleFullScreen() || w.isFullScreen() : w.isFullScreen();
}

function setFullscreen(w: BrowserWindow, on: boolean): void {
  // Simple fullscreen on macOS skips the Spaces animation, covers the menu bar and
  // hides the title bar; leaving it restores the window's previous frame.
  if (process.platform === 'darwin') w.setSimpleFullScreen(on);
  else w.setFullScreen(on);
}

function displayOf(w: BrowserWindow): Display {
  return screen.getDisplayMatching(w.getBounds());
}

export function outputStatus(): DesktopOutputStatus {
  const w = outputWindow();
  if (!w) return { open: false, fullscreen: false, width: 0, height: 0 };
  const display = displayOf(w);
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

/** Puts the window on `display`: fullscreen there if it was fullscreen, else centered as a window. */
function moveTo(w: BrowserWindow, display: Display): void {
  const full = isFullscreen(w);
  // A fullscreen window can only change displays out of fullscreen.
  if (full) setFullscreen(w, false);
  w.setBounds(windowedBounds(display.workArea, w.getBounds()));
  if (full) setFullscreen(w, true);
}

/** Makes a fullscreen output cover its display again after the display changed. */
function refit(): void {
  const w = outputWindow();
  if (!w || !isFullscreen(w)) return broadcastStatus();
  const display = displayOf(w);
  const b = w.getBounds();
  if (!sameRect(b, display.bounds)) {
    setFullscreen(w, false);
    w.setBounds(windowedBounds(display.workArea, w.getBounds()));
    setFullscreen(w, true);
  }
  broadcastStatus();
}

function sameRect(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Opens the output window fullscreen on a display (the requested one, else an external
 * one). An open window is moved there only when another display is requested; otherwise
 * it keeps its place and mode and is just brought to the front.
 */
export async function openOutput(url: string, webPreferences: WebPreferences, requested?: number): Promise<void> {
  const existing = outputWindow();
  if (existing) {
    const target = requested !== undefined ? screen.getAllDisplays().find((d) => d.id === requested) : undefined;
    if (target && target.id !== displayOf(existing).id) moveTo(existing, target);
    if (target) requestedDisplay = target.id;
    existing.show();
    existing.focus();
    broadcastStatus();
    return;
  }
  const display = pickDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), requested ?? requestedDisplay);
  requestedDisplay = display.id;
  const w = new BrowserWindow({
    ...windowedBounds(display.workArea),
    title: 'Web Mapper Output',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    fullscreenable: true,
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

export function setOutputFullscreen(on?: boolean): void {
  const w = outputWindow();
  if (!w) return;
  const next = on ?? !isFullscreen(w);
  if (next !== isFullscreen(w)) setFullscreen(w, next);
  broadcastStatus();
}

/** Display added/removed or resolution changed. The OS moves windows first, so wait a moment. */
export function onDisplaysChanged(): void {
  setTimeout(refit, 300);
}
