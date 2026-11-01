export interface Thumb {
  width: number;
  height: number;
  /** 4 bytes per pixel (BGRA or RGBA; only compared with thumbnails of the same kind). */
  pixels: Uint8Array;
}

/**
 * The screen a window fills, judged from desktopCapturer thumbnails: same shape and
 * nearly the same picture. On macOS, a window in fullscreen (e.g. a YouTube video put
 * fullscreen in Chrome) captures with a wrong frame size and the picture shifted into a
 * corner, while its screen captures correctly, so the screen is captured instead.
 */
export function screenFilledBy<T extends Thumb>(window: Thumb, screens: T[], maxDiff = 24): T | undefined {
  let best: T | undefined;
  let bestDiff = Infinity;
  for (const s of screens) {
    // Same width; as tall as the screen, or a little shorter: on a MacBook with a notch,
    // fullscreen windows stay below the menu-bar strip.
    const gap = s.height - window.height;
    if (s.width !== window.width || s.width * s.height === 0 || gap < 0 || gap > s.height * 0.08) continue;
    const diff = meanDifference(window.pixels, s.pixels.subarray(gap * s.width * 4));
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return bestDiff <= maxDiff ? best : undefined;
}

/** Mean absolute difference of the color channels (0..255). */
function meanDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    count += 3;
  }
  return count ? sum / count : Infinity;
}
