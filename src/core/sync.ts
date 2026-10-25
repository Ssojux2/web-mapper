import type { MediaKind, Project } from './model';

// Controller ⇄ output window messages. Both windows are on the same origin, so a
// BroadcastChannel reaches the output window however it was opened, and File
// objects travel through it by structured clone.

export interface TransportState {
  mediaId: string;
  playing: boolean;
  /** Playback position in seconds at `sentAt`. */
  time: number;
}

export type SyncMessage =
  | { type: 'hello' }
  | { type: 'controller-hello' }
  | { type: 'project'; project: Project }
  | { type: 'media-file'; mediaId: string; kind: MediaKind; file: File }
  | { type: 'transport'; states: TransportState[]; sentAt: number }
  | { type: 'output-status'; fullscreen: boolean; width: number; height: number }
  | { type: 'output-closed' };

const CHANNEL = 'web-mapper';

export class SyncChannel {
  private channel = new BroadcastChannel(CHANNEL);
  private listeners = new Set<(msg: SyncMessage) => void>();

  constructor() {
    this.channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      for (const l of this.listeners) l(e.data);
    };
  }

  post(msg: SyncMessage): void {
    this.channel.postMessage(msg);
  }

  on(listener: (msg: SyncMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.channel.close();
    this.listeners.clear();
  }
}
