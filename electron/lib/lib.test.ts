import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureRegistry } from './capture-registry';
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
  it('drops what a closed window had armed', () => {
    const r = new CaptureRegistry();
    r.select(3, 'a', { id: 'screen:1', name: 'A' });
    r.forgetWindow(3);
    expect(r.take(3)).toBeUndefined();
    expect(r.lookup('a')?.id).toBe('screen:1');
  });
});
