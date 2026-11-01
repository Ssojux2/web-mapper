import { BrowserWindow, desktopCapturer, session, shell, systemPreferences, webContents } from 'electron';
import type { CaptureSource, ScreenPermission } from '../src/desktop/api';
import { CaptureRegistry } from './lib/capture-registry';

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

export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const wc = request.frame ? webContents.fromFrame(request.frame) : undefined;
    const source = wc && registry.take(wc.id);
    // Nothing armed: deny, which rejects getDisplayMedia() in the page.
    callback(source ? { video: source } : null);
  });
}
