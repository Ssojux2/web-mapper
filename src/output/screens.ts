import { desktop } from '../desktop';

// Controller-side helpers for placing the output window on the projector.
// Web: Window Management API (getScreenDetails) is Chrome/Edge only; elsewhere the
// output window opens as a normal popup that the user drags to the projector.
// Desktop app: the main process lists the displays and opens the output fullscreen on one.

export interface ScreenOption {
  label: string;
  primary: boolean;
  width: number;
  height: number;
  /** Physical pixel size, for "adapt output to display". */
  pixelWidth: number;
  pixelHeight: number;
  /** Web: the screen to place the popup on. */
  screen?: ScreenDetailed;
  /** Desktop app: Electron display id. */
  displayId?: number;
}

export const supportsScreenPlacement = !!desktop || (typeof window !== 'undefined' && 'getScreenDetails' in window);

/** Web: asks for the window-management permission on first use. */
export async function listScreens(): Promise<ScreenOption[]> {
  if (desktop) {
    return (await desktop.displays()).map((d) => ({
      label: d.label,
      primary: d.primary,
      width: d.bounds.width,
      height: d.bounds.height,
      pixelWidth: Math.round(d.bounds.width * d.scaleFactor),
      pixelHeight: Math.round(d.bounds.height * d.scaleFactor),
      displayId: d.id,
    }));
  }
  if (!window.getScreenDetails) return [];
  const details = await window.getScreenDetails();
  return details.screens.map((s, i) => ({
    label: s.label || `화면 ${i + 1}`,
    primary: s.isPrimary,
    width: s.width,
    height: s.height,
    pixelWidth: Math.round(s.width * s.devicePixelRatio),
    pixelHeight: Math.round(s.height * s.devicePixelRatio),
    screen: s,
  }));
}

let outputWindow: Window | null = null;

/**
 * Opens the output window, on `target` when given, and resolves to false if it could not
 * (popup blocked). On the web this must run inside a click handler.
 */
export function openOutputWindow(target?: ScreenOption): Promise<boolean> {
  if (desktop) return desktop.output.open(target?.displayId).then(() => true);
  const s = target?.screen;
  const features = s
    ? `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`
    : 'popup,width=1280,height=720';
  if (outputWindow && !outputWindow.closed) {
    if (s) {
      outputWindow.moveTo(s.availLeft, s.availTop);
      outputWindow.resizeTo(s.availWidth, s.availHeight);
    }
    outputWindow.focus();
    return Promise.resolve(true);
  }
  outputWindow = window.open(new URL('output.html', location.href).href, 'web-mapper-output', features);
  return Promise.resolve(!!outputWindow);
}

export function closeOutputWindow(): void {
  if (desktop) {
    void desktop.output.close();
    return;
  }
  if (outputWindow && !outputWindow.closed) outputWindow.close();
  outputWindow = null;
}
