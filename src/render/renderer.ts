import * as twgl from 'twgl.js';
import { pixelsToClip, squareToQuad, toGL } from '../core/geometry';
import { surfaceGeometry } from '../core/mesh';
import type { Project, Surface } from '../core/model';
import { MaskCache } from './masks';
import { fullscreenVert, surfaceFrag, surfaceVert, testPatternFrag } from './shaders';
import { TextureCache, type TexSource } from './videoTextures';

export type SourceLookup = (mediaId: string) => TexSource | undefined;

interface GpuGeometry {
  surface: Surface;
  vao: WebGLVertexArrayObject;
  position: WebGLBuffer;
  st: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
}

/**
 * Draws a project's surfaces onto a canvas. The canvas may be smaller than the output
 * resolution (editor preview); geometry is always expressed in output pixels.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private surfaceProgram: twgl.ProgramInfo;
  private patternProgram: twgl.ProgramInfo;
  private fullscreen: twgl.VertexArrayInfo;
  private geometries = new Map<string, GpuGeometry>();
  private white: WebGLTexture;
  readonly textures: TextureCache;
  readonly masks: MaskCache;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true });
    if (!gl) throw new Error('이 브라우저는 WebGL2를 지원하지 않습니다.');
    this.gl = gl;
    this.surfaceProgram = twgl.createProgramInfo(gl, [surfaceVert, surfaceFrag]);
    this.patternProgram = twgl.createProgramInfo(gl, [fullscreenVert, testPatternFrag]);
    const fsBuffer = twgl.createBufferInfoFromArrays(gl, {
      a_pos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    this.fullscreen = twgl.createVertexArrayInfo(gl, this.patternProgram, fsBuffer);
    // Full coverage, used for surfaces without masks.
    this.white = twgl.createTexture(gl, { src: [255, 255, 255, 255], width: 1, height: 1 });
    this.textures = new TextureCache(gl);
    this.masks = new MaskCache(gl);
  }

  /** Sets the canvas backing size, keeping the output aspect and at most `maxWidth` pixels wide. */
  setSize(outputWidth: number, outputHeight: number, maxWidth = Infinity): void {
    const scale = Math.min(1, maxWidth / outputWidth);
    const w = Math.max(1, Math.round(outputWidth * scale));
    const h = Math.max(1, Math.round(outputHeight * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(project: Project, lookup: SourceLookup): void {
    const gl = this.gl;
    const { width, height } = project.output;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (project.output.testPattern) {
      gl.disable(gl.BLEND);
      gl.useProgram(this.patternProgram.program);
      twgl.setBuffersAndAttributes(gl, this.patternProgram, this.fullscreen);
      twgl.setUniforms(this.patternProgram, { u_res: [width, height], u_scale: this.canvas.width / width });
      twgl.drawBufferInfo(gl, this.fullscreen);
      return;
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.surfaceProgram.program);
    const clip = toGL(pixelsToClip(width, height));

    for (const surface of project.surfaces) {
      if (!surface.visible || surface.opacity <= 0) continue;
      const source = lookup(surface.mediaId);
      if (!source) continue;
      const tex = this.textures.get(surface.mediaId, source);
      if (!tex) continue;
      const mask = this.masks.get(surface, width, height) ?? this.white;
      const geometry = this.geometry(surface);
      twgl.setUniforms(this.surfaceProgram, {
        u_clip: clip,
        u_input: toGL(squareToQuad(surface.input)),
        u_tex: tex,
        u_mask: mask,
        u_canvas: [this.canvas.width, this.canvas.height],
        u_opacity: surface.opacity,
      });
      gl.bindVertexArray(geometry.vao);
      gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);

    const ids = new Set(project.surfaces.map((s) => s.id));
    this.masks.retain(ids);
    for (const [id, g] of this.geometries) if (!ids.has(id)) this.releaseGeometry(id, g);
  }

  /** GPU buffers for a surface, re-uploaded only when the surface object changed. */
  private geometry(surface: Surface): GpuGeometry {
    const gl = this.gl;
    let g = this.geometries.get(surface.id);
    if (g && g.surface === surface) return g;
    if (!g) {
      const vao = gl.createVertexArray()!;
      const position = gl.createBuffer()!;
      const st = gl.createBuffer()!;
      const index = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      const program = this.surfaceProgram.program;
      const posLoc = gl.getAttribLocation(program, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
      const stLoc = gl.getAttribLocation(program, 'a_st');
      gl.bindBuffer(gl.ARRAY_BUFFER, st);
      gl.enableVertexAttribArray(stLoc);
      gl.vertexAttribPointer(stLoc, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      g = { surface, vao, position, st, index, count: 0 };
      this.geometries.set(surface.id, g);
    }
    const data = surfaceGeometry(surface);
    gl.bindVertexArray(g.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.position);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.st);
    gl.bufferData(gl.ARRAY_BUFFER, data.st, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.DYNAMIC_DRAW);
    g.surface = surface;
    g.count = data.indices.length;
    return g;
  }

  private releaseGeometry(id: string, g: GpuGeometry): void {
    const gl = this.gl;
    gl.deleteVertexArray(g.vao);
    gl.deleteBuffer(g.position);
    gl.deleteBuffer(g.st);
    gl.deleteBuffer(g.index);
    this.geometries.delete(id);
  }

  /** Renders and reads back one pixel (output coordinates). Debug/testing aid. */
  readPixel(project: Project, lookup: SourceLookup, x: number, y: number): [number, number, number, number] {
    this.render(project, lookup);
    const s = this.canvas.width / project.output.width;
    const px = new Uint8Array(4);
    this.gl.readPixels(Math.floor(x * s), Math.floor(this.canvas.height - 1 - y * s), 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2], px[3]];
  }

  /** Frees GPU resources. The context itself stays usable, so a canvas can get a new Renderer. */
  dispose(): void {
    this.textures.dispose();
    this.masks.dispose();
    for (const [id, g] of this.geometries) this.releaseGeometry(id, g);
  }
}
