export interface SourceRef {
  id: string;
  name: string;
}

interface Entry {
  /** What the user picked. */
  picked: SourceRef;
  /** What is captured right now: the pick, or the screen a picked window fills in fullscreen. */
  current: SourceRef;
}

/**
 * Which capture source belongs to which media item, and which source each window's
 * next getDisplayMedia() call should receive (a queue, so concurrent picks stay in order).
 */
export class CaptureRegistry {
  private byMedia = new Map<string, Entry>();
  private pending = new Map<number, SourceRef[]>();

  /** A new pick for the media, armed for this window. */
  select(windowId: number, mediaId: string, source: SourceRef): void {
    this.byMedia.set(mediaId, { picked: source, current: source });
    this.enqueue(windowId, source);
  }

  /** Arms the media's current source for this window; false when the media is unknown. */
  arm(windowId: number, mediaId: string): boolean {
    const entry = this.byMedia.get(mediaId);
    if (entry) this.enqueue(windowId, entry.current);
    return !!entry;
  }

  lookup(mediaId: string): SourceRef | undefined {
    return this.byMedia.get(mediaId)?.current;
  }

  /** Media whose pick is a window, with that window. */
  windowPicks(): [string, SourceRef][] {
    return [...this.byMedia].filter(([, e]) => e.picked.id.startsWith('window:')).map(([id, e]) => [id, e.picked]);
  }

  /** Points the media at another source (or back at its pick). True when that changed anything. */
  setCurrent(mediaId: string, source: SourceRef | null): boolean {
    const entry = this.byMedia.get(mediaId);
    if (!entry) return false;
    const next = source ?? entry.picked;
    if (next.id === entry.current.id) return false;
    entry.current = next;
    return true;
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

  private enqueue(windowId: number, source: SourceRef): void {
    const queue = this.pending.get(windowId) ?? [];
    queue.push(source);
    this.pending.set(windowId, queue);
  }
}
