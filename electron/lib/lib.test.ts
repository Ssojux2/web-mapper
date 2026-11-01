import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureRegistry } from './capture-registry';
import { screenFilledBy } from './fullscreen-match';
import { pickDisplay, windowedBounds } from './displays';
import { resolveAppPath } from './paths';

describe('resolveAppPath', () => {
  const root = path.resolve('/app/dist');
  it('serves files inside the root, and the editor for /', () => {
    expect(resolveAppPath(root, '/output.html')).toBe(path.join(root, 'output.html'));
    expect(resolveAppPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, '/assets/a%20b.js')).toBe(path.join(root, 'assets', 'a b.js'));
  });
  it('refuses paths that escape the root', () => {
    expect(resolveAppPath(root, '/../secret')).toBeNull();
    expect(resolveAppPath(root, '/%2e%2e/secret')).toBeNull();
    expect(resolveAppPath(root, '/%E0%A4%A')).toBeNull();
  });
});

describe('pickDisplay', () => {
  const primary = { id: 1 };
  const projector = { id: 2 };
  it('prefers the requested display, then an external one, then the primary', () => {
    expect(pickDisplay([primary, projector], primary, 1)).toBe(primary);
    expect(pickDisplay([primary, projector], primary)).toBe(projector);
    expect(pickDisplay([primary, projector], primary, 99)).toBe(projector);
    expect(pickDisplay([primary], primary)).toBe(primary);
  });
});

describe('windowedBounds', () => {
  const work = { x: 1920, y: 25, width: 1920, height: 1055 };
  it('centers a 16:9 window on the work area', () => {
    expect(windowedBounds(work)).toEqual({ x: 1920 + 384, y: 25 + 204, width: 1152, height: 648 });
  });
  it('keeps a size that fits, and replaces one that fills or overflows the display', () => {
    expect(windowedBounds(work, { x: 0, y: 0, width: 800, height: 600 })).toEqual({ x: 1920 + 560, y: 25 + 228, width: 800, height: 600 });
    expect(windowedBounds(work, { x: 0, y: 0, width: 1920, height: 1080 }).width).toBe(1152);
    expect(windowedBounds({ x: 0, y: 0, width: 1024, height: 300 })).toMatchObject({ width: 427, height: 240 });
  });
});

describe('CaptureRegistry', () => {
  it('hands each window the sources it armed, in order, once', () => {
    const r = new CaptureRegistry();
    r.select(1, 'a', { id: 'screen:1', name: 'A' });
    r.select(1, 'b', { id: 'window:2', name: 'B' });
    r.select(2, 'a', { id: 'screen:1', name: 'A' });
    expect(r.take(1)?.id).toBe('screen:1');
    expect(r.take(1)?.id).toBe('window:2');
    expect(r.take(1)).toBeUndefined();
    expect(r.take(2)?.id).toBe('screen:1');
    expect(r.lookup('b')?.id).toBe('window:2');
  });
  it('can capture another source for a while, then return to the pick', () => {
    const r = new CaptureRegistry();
    r.select(1, 'a', { id: 'window:7:0', name: 'YouTube' });
    r.take(1);
    expect(r.windowPicks()).toEqual([['a', { id: 'window:7:0', name: 'YouTube' }]]);
    expect(r.setCurrent('a', { id: 'screen:2:0', name: 'Screen 2' })).toBe(true);
    expect(r.setCurrent('a', { id: 'screen:2:0', name: 'Screen 2' })).toBe(false);
    expect(r.lookup('a')?.id).toBe('screen:2:0');
    expect(r.arm(2, 'a')).toBe(true);
    expect(r.take(2)?.id).toBe('screen:2:0');
    expect(r.setCurrent('a', null)).toBe(true);
    expect(r.lookup('a')?.id).toBe('window:7:0');
    expect(r.arm(2, 'missing')).toBe(false);
  });
  it('drops what a closed window had armed', () => {
    const r = new CaptureRegistry();
    r.select(3, 'a', { id: 'screen:1', name: 'A' });
    r.forgetWindow(3);
    expect(r.take(3)).toBeUndefined();
    expect(r.lookup('a')?.id).toBe('screen:1');
  });
});

describe('screenFilledBy', () => {
  const img = (w: number, h: number, value: (i: number) => number) => ({
    width: w,
    height: h,
    pixels: Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : value(Math.floor(i / 4)))),
  });
  const picture = (i: number) => (i * 37) % 256;
  it('finds the screen showing the same picture in the same shape', () => {
    const win = img(16, 9, picture);
    const screens = [
      { id: 'screen:1', ...img(16, 10, picture) },
      { id: 'screen:2', ...img(16, 9, (i) => Math.min(255, picture(i) + 6)) },
      { id: 'screen:3', ...img(16, 9, () => 0) },
    ];
    expect(screenFilledBy(win, screens)?.id).toBe('screen:2');
  });
  it('accepts a window just below a notch strip at the top of the screen', () => {
    const screen = img(20, 13, (i) => (i < 20 ? 0 : picture(i - 20)));
    expect(screenFilledBy(img(20, 12, picture), [{ id: 'screen:1', ...screen }])?.id).toBe('screen:1');
  });
  it('finds none for a window that does not fill a screen', () => {
    expect(screenFilledBy(img(16, 9, picture), [{ id: 'screen:1', ...img(16, 9, (i) => 255 - picture(i)) }])).toBeUndefined();
    expect(screenFilledBy(img(16, 5, picture), [{ id: 'screen:1', ...img(16, 9, picture) }])).toBeUndefined();
  });
});
