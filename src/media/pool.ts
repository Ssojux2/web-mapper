import { TESTCARD_ID, type MediaKind } from '../core/model';
import { getTestcard } from '../render/testcard';
import type { TexSource } from '../render/videoTextures';

export interface LoadedMedia {
  width: number;
  height: number;
}

/**
 * Live media elements of one window, keyed by media id. Each window (controller and
 * output) owns its own pool so it can decode and upload frames independently.
 */
export class MediaPool {
  private elements = new Map<string, TexSource>();
  private files = new Map<string, { file: File; kind: MediaKind }>();
  private urls = new Map<string, string>();
  private streams = new Map<string, MediaStream>();
  private listeners = new Set<() => void>();

  constructor() {
    this.elements.set(TESTCARD_ID, getTestcard());
  }

  get(id: string): TexSource | undefined {
    return this.elements.get(id);
  }

  video(id: string): HTMLVideoElement | undefined {
    const el = this.elements.get(id);
    return el instanceof HTMLVideoElement ? el : undefined;
  }

  /** Live capture stream behind a media id, if it is one. */
  stream(id: string): MediaStream | undefined {
    return this.streams.get(id);
  }

  file(id: string): { file: File; kind: MediaKind } | undefined {
    return this.files.get(id);
  }

  has(id: string): boolean {
    return this.elements.has(id);
  }

  entries(): [string, { file: File; kind: MediaKind }][] {
    return [...this.files.entries()];
  }

  /** Called whenever an element is added or replaced. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Creates (or replaces) the element for a media id and resolves once its size is known. */
  async setFile(id: string, file: File, kind: MediaKind, loop = true): Promise<LoadedMedia> {
    const url = URL.createObjectURL(file);
    let el: TexSource;
    let size: LoadedMedia;
    try {
      if (kind === 'video') {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.loop = loop;
        video.preload = 'auto';
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`영상을 열 수 없습니다: ${file.name}`));
        });
        size = { width: video.videoWidth, height: video.videoHeight };
        el = video;
      } else {
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => {
          throw new Error(`이미지를 열 수 없습니다: ${file.name}`);
        });
        size = { width: img.naturalWidth, height: img.naturalHeight };
        el = img;
      }
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }

    this.dispose(id);
    this.elements.set(id, el);
    this.files.set(id, { file, kind });
    this.urls.set(id, url);
    if (el instanceof HTMLVideoElement) el.play().catch(() => {});
    for (const l of this.listeners) l();
    return size;
  }

  /**
   * Shows a live MediaStream (tab/screen capture) under a media id. The stream may come
   * from another window of this origin (the output window borrows the editor's).
   */
  async setStream(id: string, stream: MediaStream): Promise<LoadedMedia> {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('캡처 화면을 열 수 없습니다.'));
    });
    this.dispose(id);
    this.elements.set(id, video);
    this.streams.set(id, stream);
    video.play().catch(() => {});
    for (const l of this.listeners) l();
    return { width: video.videoWidth, height: video.videoHeight };
  }

  setLoop(id: string, loop: boolean): void {
    const v = this.video(id);
    if (v) v.loop = loop;
  }

  dispose(id: string): void {
    const el = this.elements.get(id);
    if (el instanceof HTMLVideoElement) {
      el.pause();
      // The stream itself is left running: its owner decides when to stop it.
      el.srcObject = null;
      el.removeAttribute('src');
      el.load();
    }
    this.streams.delete(id);
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
    this.files.delete(id);
    if (id !== TESTCARD_ID) this.elements.delete(id);
  }
}
