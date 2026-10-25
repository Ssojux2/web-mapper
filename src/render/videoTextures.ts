export type TexSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

interface Entry {
  tex: WebGLTexture;
  source: TexSource;
  uploaded: boolean;
  /** Set by requestVideoFrameCallback when the video has a new frame to show. */
  dirty: boolean;
  frameHandle?: number;
}

/**
 * One GL texture per media item, shared by every surface that shows it. Video frames
 * are uploaded only when requestVideoFrameCallback reports a new frame (or every
 * frame where rVFC is unavailable), which is what keeps 4K playback affordable.
 */
export class TextureCache {
  private entries = new Map<string, Entry>();

  constructor(private gl: WebGL2RenderingContext) {}

  get(mediaId: string, source: TexSource): WebGLTexture | null {
    let entry = this.entries.get(mediaId);
    if (entry && entry.source !== source) {
      this.release(mediaId);
      entry = undefined;
    }
    if (!entry) {
      entry = this.create(source);
      this.entries.set(mediaId, entry);
    }

    if (source instanceof HTMLVideoElement) {
      if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return entry.uploaded ? entry.tex : null;
      const hasRvfc = 'requestVideoFrameCallback' in source;
      if (!entry.uploaded || entry.dirty || !hasRvfc) this.upload(entry);
    } else if (!entry.uploaded) {
      if (source instanceof HTMLImageElement && !(source.complete && source.naturalWidth > 0)) return null;
      this.upload(entry);
    }
    return entry.uploaded ? entry.tex : null;
  }

  /** Forces a re-upload of a canvas/image source whose pixels changed. */
  invalidate(mediaId: string): void {
    const entry = this.entries.get(mediaId);
    if (entry) entry.uploaded = false;
  }

  release(mediaId: string): void {
    const entry = this.entries.get(mediaId);
    if (!entry) return;
    if (entry.frameHandle !== undefined && entry.source instanceof HTMLVideoElement) {
      entry.source.cancelVideoFrameCallback(entry.frameHandle);
    }
    this.gl.deleteTexture(entry.tex);
    this.entries.delete(mediaId);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.release(id);
  }

  private create(source: TexSource): Entry {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const entry: Entry = { tex, source, uploaded: false, dirty: true };
    if (source instanceof HTMLVideoElement && 'requestVideoFrameCallback' in source) {
      const onFrame = () => {
        entry.dirty = true;
        entry.frameHandle = source.requestVideoFrameCallback(onFrame);
      };
      entry.frameHandle = source.requestVideoFrameCallback(onFrame);
    }
    return entry;
  }

  private upload(entry: Entry): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // RGBA straight from the element: the fast path in Chrome and Safari.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
    entry.uploaded = true;
    entry.dirty = false;
  }
}
