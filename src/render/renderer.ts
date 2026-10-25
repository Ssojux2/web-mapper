import * as twgl from 'twgl.js';
import { multiply, pixelsToClip, squareToQuad, toGL } from '../core/geometry';
import type { Project } from '../core/model';
import { fullscreenVert, surfaceFrag, surfaceVert, testPatternFrag } from './shaders';
import { TextureCache, type TexSource } from './videoTextures';

export type SourceLookup = (mediaId: string) => TexSource | undefined;

/**
 * Draws a project's surfaces onto a canvas. The canvas may be smaller than the output
 * resolution (editor preview); geometry is always expressed in output pixels.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private surfaceProgram: twgl.ProgramInfo;
  private patternProgram: twgl.ProgramInfo;
  private quad: twgl.VertexArrayInfo;
  private fullscreen: twgl.VertexArrayInfo;
  readonly textures: TextureCache;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true });
    if (!gl) throw new Error('이 브라우저는 WebGL2를 지원하지 않습니다.');
    this.gl = gl;
    this.surfaceProgram = twgl.createProgramInfo(gl, [surfaceVert, surfaceFrag]);
    this.patternProgram = twgl.createProgramInfo(gl, [fullscreenVert, testPatternFrag]);
    // Unit square as two triangles; corners match the Quad order TL, TR, BR, BL.
    const quadBuffer = twgl.createBufferInfoFromArrays(gl, {
      a_st: { numComponents: 2, data: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] },
    });
    this.quad = twgl.createVertexArrayInfo(gl, this.surfaceProgram, quadBuffer);
    const fsBuffer = twgl.createBufferInfoFromArrays(gl, {
      a_pos: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
    });
    this.fullscreen = twgl.createVertexArrayInfo(gl, this.patternProgram, fsBuffer);
    this.textures = new TextureCache(gl);
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
    twgl.setBuffersAndAttributes(gl, this.surfaceProgram, this.quad);
    const clip = pixelsToClip(width, height);

    for (const surface of project.surfaces) {
      if (!surface.visible || surface.opacity <= 0) continue;
      const source = lookup(surface.mediaId);
      if (!source) continue;
      const tex = this.textures.get(surface.mediaId, source);
      if (!tex) continue;
      twgl.setUniforms(this.surfaceProgram, {
        u_output: toGL(multiply(clip, squareToQuad(surface.output))),
        u_input: toGL(squareToQuad(surface.input)),
        u_tex: tex,
        u_opacity: surface.opacity,
      });
      twgl.drawBufferInfo(gl, this.quad);
    }
  }

  /** Renders and reads back one pixel (output coordinates). Debug/testing aid. */
  readPixel(project: Project, lookup: SourceLookup, x: number, y: number): [number, number, number, number] {
    this.render(project, lookup);
    const s = this.canvas.width / project.output.width;
    const px = new Uint8Array(4);
    this.gl.readPixels(Math.floor(x * s), Math.floor(this.canvas.height - 1 - y * s), 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2], px[3]];
  }

  /** Frees GPU textures. The context itself stays usable, so a canvas can get a new Renderer. */
  dispose(): void {
    this.textures.dispose();
  }
}
