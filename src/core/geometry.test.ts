import { describe, expect, it } from 'vitest';
import { apply, invert, multiply, pointInQuad, quadToQuad, squareToQuad, IDENTITY } from './geometry';
import type { Quad } from './model';

const square: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const keystone: Quad = [
  { x: 312.5, y: 140.25 },
  { x: 1650, y: 80 },
  { x: 1810.75, y: 1003 },
  { x: 140, y: 920.5 },
];

const parallelogram: Quad = [
  { x: 100, y: 100 },
  { x: 900, y: 150 },
  { x: 1000, y: 650 },
  { x: 200, y: 600 },
];

describe('squareToQuad', () => {
  for (const [name, q] of [
    ['perspective quad', keystone],
    ['parallelogram (affine branch)', parallelogram],
  ] as const) {
    it(`maps unit-square corners exactly onto the ${name}`, () => {
      const m = squareToQuad(q);
      square.forEach((s, i) => {
        const p = apply(m, s);
        expect(Math.abs(p.x - q[i].x)).toBeLessThan(1e-6);
        expect(Math.abs(p.y - q[i].y)).toBeLessThan(1e-6);
      });
    });

    it(`inverts back to the unit square for the ${name}`, () => {
      const inv = invert(squareToQuad(q));
      q.forEach((p, i) => {
        const s = apply(inv, p);
        expect(Math.abs(s.x - square[i].x)).toBeLessThan(1e-9);
        expect(Math.abs(s.y - square[i].y)).toBeLessThan(1e-9);
      });
    });
  }

  it('is projective, not bilinear: the square center lands on the diagonal intersection', () => {
    const c = apply(squareToQuad(keystone), { x: 0.5, y: 0.5 });
    // Intersection of diagonals 0-2 and 1-3.
    const [a, b, d, e] = [keystone[0], keystone[2], keystone[1], keystone[3]];
    const t =
      ((a.x - d.x) * (d.y - e.y) - (a.y - d.y) * (d.x - e.x)) / ((a.x - b.x) * (d.y - e.y) - (a.y - b.y) * (d.x - e.x));
    expect(c.x).toBeCloseTo(a.x + t * (b.x - a.x), 6);
    expect(c.y).toBeCloseTo(a.y + t * (b.y - a.y), 6);
  });
});

describe('matrix helpers', () => {
  it('m * inverse(m) is the identity', () => {
    const m = squareToQuad(keystone);
    multiply(m, invert(m)).forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
  });

  it('quadToQuad maps corners onto corners', () => {
    const m = quadToQuad(parallelogram, keystone);
    parallelogram.forEach((p, i) => {
      const r = apply(m, p);
      expect(r.x).toBeCloseTo(keystone[i].x, 6);
      expect(r.y).toBeCloseTo(keystone[i].y, 6);
    });
  });
});

describe('pointInQuad', () => {
  it('detects inside and outside points', () => {
    expect(pointInQuad({ x: 900, y: 500 }, keystone)).toBe(true);
    expect(pointInQuad({ x: 10, y: 10 }, keystone)).toBe(false);
    expect(pointInQuad({ x: 1900, y: 500 }, keystone)).toBe(false);
  });
});
