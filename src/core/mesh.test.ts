import { describe, expect, it } from 'vitest';
import { apply, squareToQuad } from './geometry';
import { meshControlPoints, meshOffset, pointInPolygon, resampleMesh, segmentDistance, surfaceGeometry, surfacePoint } from './mesh';
import { createMesh, createProject, createSurface, type Mesh, type Quad, type Surface } from './model';

const keystone: Quad = [
  { x: 312.5, y: 140.25 },
  { x: 1650, y: 80 },
  { x: 1810.75, y: 1003 },
  { x: 140, y: 920.5 },
];

function surface(mesh?: Mesh): Surface {
  const p = createProject();
  return { ...createSurface(p, p.media[0]), output: keystone, mesh };
}

function bumpyMesh(smooth: boolean): Mesh {
  const m = createMesh(4, 3, smooth);
  m.offsets = m.offsets.map((_, k) => ({ x: ((k * 37) % 11) - 5, y: ((k * 53) % 13) - 6 }));
  for (const k of [0, 4, 15, 19]) m.offsets[k] = { x: 0, y: 0 };
  return m;
}

describe('meshOffset', () => {
  for (const smooth of [false, true]) {
    it(`passes through every control point (${smooth ? 'smooth' : 'linear'})`, () => {
      const m = bumpyMesh(smooth);
      for (let j = 0; j <= m.rows; j++) {
        for (let i = 0; i <= m.cols; i++) {
          const o = meshOffset(m, i / m.cols, j / m.rows);
          const c = m.offsets[j * (m.cols + 1) + i];
          expect(o.x).toBeCloseTo(c.x, 9);
          expect(o.y).toBeCloseTo(c.y, 9);
        }
      }
    });
  }

  it('is zero everywhere for a flat mesh', () => {
    const o = meshOffset(createMesh(5, 5), 0.37, 0.81);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });
});

describe('surfaceGeometry', () => {
  it('a flat mesh reproduces the corner-pin homography exactly', () => {
    const s = surface(createMesh(3, 3));
    const H = squareToQuad(keystone);
    const g = surfaceGeometry(s);
    for (let k = 0; k < g.st.length / 2; k += 7) {
      const expected = apply(H, { x: g.st[k * 2], y: g.st[k * 2 + 1] });
      const w = g.positions[k * 3 + 2];
      expect(g.positions[k * 3] / w).toBeCloseTo(expected.x, 2);
      expect(g.positions[k * 3 + 1] / w).toBeCloseTo(expected.y, 2);
    }
  });

  it('a plain quad is two triangles whose outline is the quad', () => {
    const g = surfaceGeometry(surface());
    expect(g.indices).toHaveLength(6);
    expect(g.outline).toHaveLength(4);
    g.outline.forEach((p, i) => {
      expect(p.x).toBeCloseTo(keystone[i].x, 3);
      expect(p.y).toBeCloseTo(keystone[i].y, 3);
    });
  });

  it('warped vertices land on the warped surface points', () => {
    const s = surface(bumpyMesh(true));
    const g = surfaceGeometry(s);
    const k = 123;
    const w = g.positions[k * 3 + 2];
    const p = surfacePoint(s, g.st[k * 2], g.st[k * 2 + 1]);
    expect(g.positions[k * 3] / w).toBeCloseTo(p.x, 2);
    expect(g.positions[k * 3 + 1] / w).toBeCloseTo(p.y, 2);
    expect(Math.max(...g.indices)).toBeLessThan(g.st.length / 2);
  });

  it('is memoized per surface object', () => {
    const s = surface(createMesh());
    expect(surfaceGeometry(s)).toBe(surfaceGeometry(s));
  });
});

describe('mesh helpers', () => {
  it('control points include the offsets', () => {
    const m = bumpyMesh(false);
    const s = surface(m);
    const pts = meshControlPoints(s);
    const H = squareToQuad(keystone);
    const base = apply(H, { x: 1 / 4, y: 1 / 3 });
    expect(pts[6].x).toBeCloseTo(base.x + m.offsets[6].x, 6);
    expect(pts[6].y).toBeCloseTo(base.y + m.offsets[6].y, 6);
  });

  it('resampling to a finer grid keeps the existing control points', () => {
    const m = bumpyMesh(true);
    const fine = resampleMesh(m, 8, 6);
    expect(fine.offsets).toHaveLength(9 * 7);
    // Old point (i=1, j=1) is new point (2, 2).
    expect(fine.offsets[2 * 9 + 2].x).toBeCloseTo(m.offsets[1 * 5 + 1].x, 9);
    expect(fine.offsets[2 * 9 + 2].y).toBeCloseTo(m.offsets[1 * 5 + 1].y, 9);
    expect(fine.offsets[0]).toEqual({ x: 0, y: 0 });
  });

  it('pointInPolygon and segmentDistance', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 2 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, tri)).toBe(false);
    const r = segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(r.d).toBeCloseTo(3);
    expect(r.t).toBeCloseTo(0.5);
  });
});
