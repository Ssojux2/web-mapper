import type { Point, Quad } from './model';

/** Row-major 3x3 matrix: [a, b, c, d, e, f, g, h, i]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Projective map from the unit square to a quad (Heckbert's closed form):
 * (0,0)→q[0], (1,0)→q[1], (1,1)→q[2], (0,1)→q[3].
 */
export function squareToQuad(q: Quad): Mat3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    // Parallelogram: the map is affine.
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }

  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return IDENTITY;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

export function apply(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

/** Projective map taking quad `from` onto quad `to`, corner for corner. */
export function quadToQuad(from: Quad, to: Quad): Mat3 {
  return multiply(squareToQuad(to), invert(squareToQuad(from)));
}

/** Column-major Float32Array for gl.uniformMatrix3fv(loc, false, …). */
export function toGL(m: Mat3): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

/** Maps output pixels (y down) to clip space. */
export function pixelsToClip(width: number, height: number): Mat3 {
  return [2 / width, 0, -1, 0, -2 / height, 1, 0, 0, 1];
}

export function pointInQuad(p: Point, q: Quad): boolean {
  // Even-odd ray casting; also works for concave (self-intersecting excluded) quads.
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = q[i];
    const b = q[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

export function setCorner(q: Quad, index: number, p: Point): Quad {
  return q.map((c, i) => (i === index ? { x: p.x, y: p.y } : c)) as Quad;
}

export function quadCenter(q: Quad): Point {
  return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** CSS matrix3d() for a 2D projective map, so an element can be corner-pinned in the DOM. */
export function toCssMatrix3d(m: Mat3): string {
  const [a, b, c, d, e, f, g, h, i] = m;
  return `matrix3d(${[a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].join(',')})`;
}
