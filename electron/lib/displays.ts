export interface DisplayLike {
  id: number;
}

/** The display to project on: the requested one, else the first external display, else the primary. */
export function pickDisplay<T extends DisplayLike>(displays: T[], primary: T, requested?: number): T {
  return displays.find((d) => d.id === requested) ?? displays.find((d) => d.id !== primary.id) ?? primary;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the output sits as a window on a display's work area: centered, keeping the
 * current size when it fits, else a 16:9 window about 60% of the work area wide.
 */
export function windowedBounds(work: Rect, current?: Rect): Rect {
  let width: number;
  let height: number;
  if (current && current.width <= work.width && current.height <= work.height && current.width < work.width * 0.98) {
    ({ width, height } = current);
  } else {
    width = Math.round(work.width * 0.6);
    height = Math.round((width * 9) / 16);
    if (height > work.height * 0.8) {
      height = Math.round(work.height * 0.8);
      width = Math.round((height * 16) / 9);
    }
  }
  return { x: Math.round(work.x + (work.width - width) / 2), y: Math.round(work.y + (work.height - height) / 2), width, height };
}
