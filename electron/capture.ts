import { BrowserWindow, desktopCapturer, session, shell, systemPreferences, webContents } from 'electron';
import type { CaptureSource, ScreenPermission } from '../src/desktop/api';
import { CaptureRegistry } from './lib/capture-registry';
import { IPC } from './lib/channels';
import { screenFilledBy } from './lib/fullscreen-match';

// Screen/window capture without Chrome's picker or sharing bar. The renderer picks a
// source in its own dialog, arms it with select(), then calls getDisplayMedia() as
// usual; the handler below answers with the armed source for that window.

const registry = new CaptureRegistry();

export async function listSources(): Promise<CaptureSource[]> {
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  } catch (err) {
    if (screenPermission() !== 'granted') throw new Error('화면 기록 권한이 없어 창 목록을 가져오지 못했습니다.', { cause: err });
    throw err;
  }
  return sources
    .filter((s) => !own.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    }));
}

export async function selectSource(windowId: number, mediaId: string, sourceId: string): Promise<void> {
  const name = (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })).find(
    (s) => s.id === sourceId,
  )?.name;
  registry.select(windowId, mediaId, { id: sourceId, name: name ?? sourceId });
}

/** Arms the media's current source for the window's next getDisplayMedia() call. */
export function armSource(windowId: number, mediaId: string): boolean {
  return registry.arm(windowId, mediaId);
}

export function lookupSource(mediaId: string): string | null {
  return registry.lookup(mediaId)?.id ?? null;
}

export function forgetWindow(windowId: number): void {
  registry.forgetWindow(windowId);
}

export function screenPermission(): ScreenPermission {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen') as ScreenPermission;
}

export function openScreenSettings(): Promise<void> {
  if (process.platform !== 'darwin') return Promise.resolve();
  return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
}

/**
 * macOS captures a fullscreen window (a YouTube video in fullscreen, say) with a wrong
 * frame: the picture lands shrunk in a corner with black around it. While a picked
 * window fills a screen, that screen is captured instead, and the window again once it
 * leaves fullscreen. Windows report the change through IPC.captureChanged and capture
 * the media's current source again.
 */
let watching = false;
async function watchFullscreenWindows(): Promise<void> {
  const picks = registry.windowPicks();
  if (watching || picks.length === 0) return;
  watching = true;
  try {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 96, height: 96 } });
    const thumb = (s: Electron.DesktopCapturerSource) => ({ ...s.thumbnail.getSize(), pixels: s.thumbnail.toBitmap() });
    const screens = sources.filter((s) => s.id.startsWith('screen:')).map((s) => ({ id: s.id, name: s.name, ...thumb(s) }));
    for (const [mediaId, picked] of picks) {
      const win = sources.find((s) => s.id === picked.id);
      if (!win) continue;
      const screen = screenFilledBy(thumb(win), screens);
      if (!registry.setCurrent(mediaId, screen ? { id: screen.id, name: screen.name } : null)) continue;
      const change = { mediaId, sourceId: registry.lookup(mediaId)!.id, fullscreen: !!screen };
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.captureChanged, change);
    }
  } catch (err) {
    console.error('capture watch', err);
  } finally {
    watching = false;
  }
}

export function installDisplayMediaHandler(): void {
  if (process.platform === 'darwin') setInterval(() => void watchFullscreenWindows(), 1500);
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
    const source = wc && registry.take(wc.id);
    // Nothing armed: deny, which rejects getDisplayMedia() in the page.
    callback(source ? { video: source } : null);
  });
}
