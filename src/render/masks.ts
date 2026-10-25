import type { Mask, Surface } from '../core/model';

interface Entry {
  masks: Mask[];
  outputWidth: number;
  outputHeight: number;
  canvas: HTMLCanvasElement;
  tex: WebGLTexture;
}

/** Longest side of a mask texture; feathered edges hide the resolution loss on 4K. */
const MAX_MASK_SIZE = 2048;

/**
 * Per-surface mask coverage textures covering the whole output frame. Rebuilt only when
 * a surface's masks array (immutable in the store) or the output size changes.
 *
 * Coverage = (union of normal masks, or everything when there are none) minus the union
 * of inverted masks. Feather is a Gaussian blur of the polygon edge.
 */
export class MaskCache {
  private entries = new Map<string, Entry>();

  constructor(private gl: WebGL2RenderingContext) {}

  /** Returns null when the surface has no active masks (draw it unmasked). */
  get(surface: Surface, outputWidth: number, outputHeight: number): WebGLTexture | null {
    const active = surface.masks.filter((m) => m.enabled && m.points.length >= 3);
    if (active.length === 0) {
      this.release(surface.id);
      return null;
    }
    let entry = this.entries.get(surface.id);
    if (entry && entry.masks === surface.masks && entry.outputWidth === outputWidth && entry.outputHeight === outputHeight) {
      return entry.tex;
    }
    if (!entry) {
      const tex = this.gl.createTexture()!;
      entry = { masks: surface.masks, outputWidth, outputHeight, canvas: document.createElement('canvas'), tex };
      this.entries.set(surface.id, entry);
    }
    entry.masks = surface.masks;
    entry.outputWidth = outputWidth;
    entry.outputHeight = outputHeight;
    drawCoverage(entry.canvas, active, outputWidth, outputHeight);
    this.upload(entry);
    return entry.tex;
  }

  /** Drops entries of surfaces that are gone. */
  retain(ids: Set<string>): void {
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this.release(id);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.release(id);
  }

  private release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.gl.deleteTexture(entry.tex);
    this.entries.delete(id);
  }

  private upload(entry: Entry): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
}

export function drawCoverage(canvas: HTMLCanvasElement, masks: Mask[], outputWidth: number, outputHeight: number): void {
  const scale = Math.min(1, MAX_MASK_SIZE / Math.max(outputWidth, outputHeight));
  canvas.width = Math.max(1, Math.round(outputWidth * scale));
  canvas.height = Math.max(1, Math.round(outputHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, outputWidth, outputHeight);
  ctx.fillStyle = '#fff';

  const fill = (m: Mask) => {
    // The blur radius is in canvas pixels; a Gaussian edge spans about 4σ.
    ctx.filter = m.feather > 0 ? `blur(${(m.feather * scale) / 4}px)` : 'none';
    ctx.beginPath();
    m.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  };

  const normal = masks.filter((m) => !m.invert);
  const inverted = masks.filter((m) => m.invert);
  ctx.globalCompositeOperation = 'source-over';
  if (normal.length === 0) {
    ctx.filter = 'none';
    ctx.fillRect(0, 0, outputWidth, outputHeight);
  } else {
    normal.forEach(fill);
  }
  ctx.globalCompositeOperation = 'destination-out';
  inverted.forEach(fill);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
}
