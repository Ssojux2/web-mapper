import { apply, squareToQuad, type Mat3 } from './geometry';
import type { Mesh, Point, Surface } from './model';

// Mesh-warp math. A surface point at unit-square coordinate (u, v) sits at
// H(u, v) + offset(u, v), where H is the corner-pin homography and offset is
// interpolated from the mesh control points.

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Interpolated offset at (u, v) ∈ [0,1]². Passes exactly through every control point. */
export function meshOffset(mesh: Mesh, u: number, v: number): Point {
  const { cols, rows, offsets } = mesh;
  const fx = Math.min(Math.max(u, 0), 1) * cols;
  const fy = Math.min(Math.max(v, 0), 1) * rows;
  const i0 = Math.min(Math.floor(fx), cols - 1);
  const j0 = Math.min(Math.floor(fy), rows - 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number) =>
    offsets[Math.min(Math.max(j, 0), rows) * (cols + 1) + Math.min(Math.max(i, 0), cols)];

  if (!mesh.smooth) {
    const a = at(i0, j0);
    const b = at(i0 + 1, j0);
    const c = at(i0, j0 + 1);
    const d = at(i0 + 1, j0 + 1);
    return {
      x: (a.x * (1 - tx) + b.x * tx) * (1 - ty) + (c.x * (1 - tx) + d.x * tx) * ty,
      y: (a.y * (1 - tx) + b.y * tx) * (1 - ty) + (c.y * (1 - tx) + d.y * tx) * ty,
    };
  }

  const row = (j: number, axis: 'x' | 'y') =>
    catmullRom(at(i0 - 1, j)[axis], at(i0, j)[axis], at(i0 + 1, j)[axis], at(i0 + 2, j)[axis], tx);
  const col = (axis: 'x' | 'y') => catmullRom(row(j0 - 1, axis), row(j0, axis), row(j0 + 1, axis), row(j0 + 2, axis), ty);
  return { x: col('x'), y: col('y') };
}

/** Final output position of the surface point (u, v). */
export function surfacePoint(surface: Surface, u: number, v: number, H: Mat3 = squareToQuad(surface.output)): Point {
  const p = apply(H, { x: u, y: v });
  if (!surface.mesh) return p;
  const o = meshOffset(surface.mesh, u, v);
  return { x: p.x + o.x, y: p.y + o.y };
}

/** Output positions of all mesh control points, row-major. */
export function meshControlPoints(surface: Surface): Point[] {
  const mesh = surface.mesh;
  if (!mesh) return [];
  const H = squareToQuad(surface.output);
  const pts: Point[] = [];
  for (let j = 0; j <= mesh.rows; j++) {
    for (let i = 0; i <= mesh.cols; i++) {
      const p = apply(H, { x: i / mesh.cols, y: j / mesh.rows });
      const o = mesh.offsets[j * (mesh.cols + 1) + i];
      pts.push({ x: p.x + o.x, y: p.y + o.y });
    }
  }
  return pts;
}

export function isMeshCorner(mesh: Mesh, index: number): boolean {
  const last = (mesh.cols + 1) * (mesh.rows + 1) - 1;
  return index === 0 || index === mesh.cols || index === last - mesh.cols || index === last;
}

/** Re-grids a mesh to a new resolution, keeping its current shape. */
export function resampleMesh(mesh: Mesh, cols: number, rows: number): Mesh {
  const offsets: Point[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) offsets.push(meshOffset(mesh, i / cols, j / rows));
  }
  const next = { cols, rows, offsets, smooth: mesh.smooth };
  for (let k = 0; k < offsets.length; k++) if (isMeshCorner(next, k)) offsets[k] = { x: 0, y: 0 };
  return next;
}

export interface SurfaceGeometry {
  /** Homogeneous output positions (x·w, y·w, w) so the GPU interpolates perspective-correctly. */
  positions: Float32Array;
  /** Unit-square coordinates per vertex. */
  st: Float32Array;
  indices: Uint16Array;
  /** Boundary polygon in output pixels (for hit tests and outlines). */
  outline: Point[];
}

const cache = new WeakMap<Surface, SurfaceGeometry>();

/**
 * Triangle mesh for drawing a surface. A plain quad is two triangles; a warped one is
 * tessellated finely enough (~48 steps per side) that curves look smooth. With all
 * offsets at zero both give exactly the corner-pin homography. Memoized per surface
 * object, which is immutable in the store.
 */
export function surfaceGeometry(surface: Surface): SurfaceGeometry {
  const hit = cache.get(surface);
  if (hit) return hit;

  const H = squareToQuad(surface.output);
  const mesh = surface.mesh;
  const nx = mesh ? mesh.cols * Math.max(2, Math.ceil(48 / mesh.cols)) : 1;
  const ny = mesh ? mesh.rows * Math.max(2, Math.ceil(48 / mesh.rows)) : 1;

  const count = (nx + 1) * (ny + 1);
  const positions = new Float32Array(count * 3);
  const st = new Float32Array(count * 2);
  const flat: Point[] = new Array(count);
  for (let b = 0; b <= ny; b++) {
    for (let a = 0; a <= nx; a++) {
      const k = b * (nx + 1) + a;
      const u = a / nx;
      const v = b / ny;
      const X = H[0] * u + H[1] * v + H[2];
      const Y = H[3] * u + H[4] * v + H[5];
      const W = H[6] * u + H[7] * v + H[8];
      const o = mesh ? meshOffset(mesh, u, v) : { x: 0, y: 0 };
      positions[k * 3] = X + o.x * W;
      positions[k * 3 + 1] = Y + o.y * W;
      positions[k * 3 + 2] = W;
      st[k * 2] = u;
      st[k * 2 + 1] = v;
      flat[k] = { x: X / W + o.x, y: Y / W + o.y };
    }
  }

  const indices = new Uint16Array(nx * ny * 6);
  let n = 0;
  for (let b = 0; b < ny; b++) {
    for (let a = 0; a < nx; a++) {
      const k = b * (nx + 1) + a;
      indices.set([k, k + 1, k + nx + 2, k, k + nx + 2, k + nx + 1], n);
      n += 6;
    }
  }

  const outline: Point[] = [];
  for (let a = 0; a < nx; a++) outline.push(flat[a]);
  for (let b = 0; b < ny; b++) outline.push(flat[b * (nx + 1) + nx]);
  for (let a = nx; a > 0; a--) outline.push(flat[ny * (nx + 1) + a]);
  for (let b = ny; b > 0; b--) outline.push(flat[b * (nx + 1)]);

  const geometry = { positions, st, indices, outline };
  cache.set(surface, geometry);
  return geometry;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to segment ab, and the parameter t of the closest point. */
export function segmentDistance(p: Point, a: Point, b: Point): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}
