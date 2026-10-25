import type { MediaPool } from './pool';

// Tab/screen capture as a media source. The editor owns the MediaStreams; the output
// window, opened by the editor, borrows the very same stream objects through
// window.opener (a MediaStream cannot be sent over BroadcastChannel).

interface CaptureHost {
  mapperCapture?: { stream(id: string): MediaStream | undefined };
}

/** Asks the user to pick a tab, window or screen. Resolves to null if they cancel. */
export async function pickCapture(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('이 브라우저는 화면 캡처를 지원하지 않습니다.');
  }
  // Chrome-only hints: prefer tabs, keep this editor tab out of the list (it would
  // capture itself), and let the user switch the shared tab while it runs.
  const options = {
    video: { frameRate: { ideal: 60 }, displaySurface: 'browser' },
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  } as DisplayMediaStreamOptions;
  try {
    return await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    if ((err as DOMException).name === 'NotAllowedError' || (err as DOMException).name === 'AbortError') return null;
    throw err;
  }
}

/** "탭 캡처" / "창 캡처" / "화면 캡처". Track labels are internal ids, so the surface type names it. */
export function captureKindLabel(stream: MediaStream): string {
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  return surface === 'browser' ? '탭 캡처' : surface === 'window' ? '창 캡처' : '화면 캡처';
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
