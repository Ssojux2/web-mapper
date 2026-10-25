// Controller-side helpers for placing the output window on the projector.
// Window Management API (getScreenDetails) is Chrome/Edge only; elsewhere the output
// window opens as a normal popup that the user drags to the projector.

export interface ScreenOption {
  label: string;
  primary: boolean;
  width: number;
  height: number;
  /** Physical pixel size, for "adapt output to display". */
  pixelWidth: number;
  pixelHeight: number;
  screen: ScreenDetailed;
}

export const supportsScreenPlacement = typeof window !== 'undefined' && 'getScreenDetails' in window;

/** Asks for the window-management permission on first use. */
export async function listScreens(): Promise<ScreenOption[]> {
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

export function isOutputOpen(): boolean {
  return !!outputWindow && !outputWindow.closed;
}

/** Opens the output window, on `target` when given. Must run inside a click handler. */
export function openOutputWindow(target?: ScreenDetailed): Window | null {
  const features = target
    ? `popup,left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight}`
    : 'popup,width=1280,height=720';
  if (isOutputOpen()) {
    if (target) {
      outputWindow!.moveTo(target.availLeft, target.availTop);
      outputWindow!.resizeTo(target.availWidth, target.availHeight);
    }
    outputWindow!.focus();
    return outputWindow;
  }
  outputWindow = window.open(new URL('output.html', location.href).href, 'web-mapper-output', features);
  return outputWindow;
}

export function closeOutputWindow(): void {
  if (isOutputOpen()) outputWindow!.close();
  outputWindow = null;
}
