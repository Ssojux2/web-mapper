import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureRegistry } from './capture-registry';
import { pickDisplay } from './displays';
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
