import type { CaptureSource, ScreenPermission } from '../desktop/api';
import { desktop } from '../desktop';
import type { MediaPool } from './pool';

// Tab/screen capture as a media source.
// Web: the editor owns the MediaStreams; the output window, opened by the editor,
// borrows the very same stream objects through window.opener (a MediaStream cannot be
// sent over BroadcastChannel).
// Desktop app: the editor picks a source in its own dialog and both windows capture
// that source themselves (see electron/capture.ts); there is no sharing bar at all.

interface CaptureHost {
  mapperCapture?: { stream(id: string): MediaStream | undefined };
}

/** The desktop app's source picker UI, installed by the editor (CapturePicker). */
export type SourceChooser = (opts: {
  load(): Promise<CaptureSource[]>;
  permission: ScreenPermission;
  openSettings(): void;
}) => Promise<CaptureSource | null>;

let chooser: SourceChooser | null = null;
export function setSourceChooser(fn: SourceChooser | null): void {
  chooser = fn;
}

/** Labels for desktop captures, whose tracks don't report a display surface. */
const kindLabels = new WeakMap<MediaStream, string>();

async function desktopDisplayMedia(mediaId: string, sourceId: string): Promise<MediaStream> {
  await desktop!.capture.select(mediaId, sourceId);
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: false });
}

async function pickDesktopCapture(mediaId: string): Promise<MediaStream | null> {
  if (!chooser) throw new Error('캡처 선택 창을 열 수 없습니다.');
  const api = desktop!.capture;
  const source = await chooser({ load: api.sources, permission: await api.permission(), openSettings: () => void api.openSettings() });
  if (!source) return null;
  const stream = await desktopDisplayMedia(mediaId, source.id);
  kindLabels.set(stream, source.kind === 'screen' ? '화면 캡처' : '창 캡처');
  return stream;
}

/** Asks the user to pick a tab, window or screen for `mediaId`. Resolves to null if they cancel. */
export async function pickCapture(mediaId: string): Promise<MediaStream | null> {
  if (desktop) return pickDesktopCapture(mediaId);
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('이 브라우저는 화면 캡처를 지원하지 않습니다.');
  }
  // Chrome-only hints. Windows come first: sharing a *tab* makes Chrome pin a
  // "Sharing … / Stop sharing" bar to every tab of every window, the output window
  // included, even in fullscreen; window/screen capture shows only a hideable notice.
  // The editor tab stays out of the list (it would capture itself), and switching the
  // shared tab mid-show is off so a stray click cannot swap what is projected.
  const options = {
    video: { frameRate: { ideal: 60 }, displaySurface: 'window' },
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
  } as DisplayMediaStreamOptions;
  try {
    return await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    if ((err as DOMException).name === 'NotAllowedError' || (err as DOMException).name === 'AbortError') return null;
    throw err;
  }
}

function displaySurface(stream: MediaStream): string | undefined {
  return (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
}

/** "탭 캡처" / "창 캡처" / "화면 캡처". Track labels are internal ids, so the surface type names it. */
export function captureKindLabel(stream: MediaStream): string {
  const known = kindLabels.get(stream);
  if (known) return known;
  const surface = displaySurface(stream);
  return surface === 'browser' ? '탭 캡처' : surface === 'window' ? '창 캡처' : '화면 캡처';
}

/** A shared tab, which puts Chrome's sharing bar on the output window too. */
export function isTabCapture(stream: MediaStream | undefined): boolean {
  return !!stream && displaySurface(stream) === 'browser';
}

export function stopStream(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Editor side: lets windows this one opened read its capture streams. */
export function exposeCaptureStreams(pool: MediaPool): void {
  (window as CaptureHost).mapperCapture = { stream: (id) => pool.stream(id) };
}

/** Output side: the editor's stream for a media id, when this window was opened by the editor. */
export function captureFromOpener(id: string): MediaStream | undefined {
  try {
    return (window.opener as CaptureHost | null)?.mapperCapture?.stream(id);
  } catch {
    // Opener navigated to another origin.
    return undefined;
  }
}

export function hasOpener(): boolean {
  try {
    return !!(window.opener as CaptureHost | null)?.mapperCapture;
  } catch {
    return false;
  }
}

/** Output side, desktop app: the source `mediaId` captures now (it changes on re-pick and fullscreen). */
export async function lookupDesktopCapture(mediaId: string): Promise<string | null> {
  return desktop ? desktop.capture.lookup(mediaId) : null;
}

/**
 * Desktop app: a new stream of the media's current source (the pick, or the screen a
 * picked window fills in fullscreen). The output window's own copy uses this too.
 */
export async function captureCurrentSource(mediaId: string): Promise<MediaStream> {
  if (!(await desktop!.capture.arm(mediaId))) throw new Error('캡처 소스를 찾을 수 없습니다. 다시 선택하세요.');
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60 } }, audio: false });
}
