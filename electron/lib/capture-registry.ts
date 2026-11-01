export interface SourceRef {
  id: string;
  name: string;
}

/**
 * Which capture source belongs to which media item, and which source each window's
 * next getDisplayMedia() call should receive (a queue, so concurrent picks stay in order).
 */
export class CaptureRegistry {
  private byMedia = new Map<string, SourceRef>();
  private pending = new Map<number, SourceRef[]>();

  select(windowId: number, mediaId: string, source: SourceRef): void {
    this.byMedia.set(mediaId, source);
    const queue = this.pending.get(windowId) ?? [];
    queue.push(source);
    this.pending.set(windowId, queue);
  }

  lookup(mediaId: string): SourceRef | undefined {
    return this.byMedia.get(mediaId);
  }

  /** The source for a window's getDisplayMedia() request, or undefined when none was armed. */
  take(windowId: number): SourceRef | undefined {
    const queue = this.pending.get(windowId);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.pending.delete(windowId);
    return next;
  }

  forgetWindow(windowId: number): void {
    this.pending.delete(windowId);
  }
}
