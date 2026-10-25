import type { TransportState } from '../core/sync';
import { followTransport } from '../output/transportSync';
import { pool } from './context';

// Playback master clock, one per video. It is a plain clock rather than the editor's
// <video> element because the browser pauses muted videos in hidden windows (e.g. when
// the output goes fullscreen on the same screen); the output must keep playing then.
// Both the editor's and the output's video elements follow this clock.

interface Clock {
  playing: boolean;
  /** Position in seconds at `at` (unwrapped; followers wrap by their duration). */
  time: number;
  at: number;
}

const clocks = new Map<string, Clock>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of listeners) l();
}

function position(c: Clock, now = Date.now()): number {
  return c.playing ? c.time + (now - c.at) / 1000 : c.time;
}

function clock(id: string): Clock {
  let c = clocks.get(id);
  if (!c) {
    c = { playing: true, time: 0, at: Date.now() };
    clocks.set(id, c);
  }
  return c;
}

/** Called on play/pause/seek; the bridge broadcasts immediately. */
export function onTransportChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current position wrapped to the video's duration, for display. */
export function currentTime(id: string): number {
  const v = pool.video(id);
  const t = position(clock(id));
  const d = v && Number.isFinite(v.duration) ? v.duration : 0;
  if (d <= 0) return t;
  return v!.loop ? t % d : Math.min(t, d);
}

export function isPlaying(id: string): boolean {
  const v = pool.video(id);
  const c = clock(id);
  if (!c.playing) return false;
  // A non-looping video that reached its end counts as stopped.
  return !(v && !v.loop && Number.isFinite(v.duration) && position(c) >= v.duration);
}

export function play(id: string): void {
  const v = pool.video(id);
  let t = currentTime(id);
  if (v && !v.loop && Number.isFinite(v.duration) && t >= v.duration - 0.05) t = 0;
  clocks.set(id, { playing: true, time: t, at: Date.now() });
  sync();
}

export function pause(id: string): void {
  clocks.set(id, { playing: false, time: currentTime(id), at: Date.now() });
  sync();
}

export function seek(id: string, time: number): void {
  clocks.set(id, { ...clock(id), time, at: Date.now() });
  sync();
}

/** Restarts a clock from zero, keeping it playing (new or replaced media). */
export function reset(id: string): void {
  clocks.set(id, { playing: true, time: 0, at: Date.now() });
  sync();
}

export function snapshot(now = Date.now()): TransportState[] {
  const states: TransportState[] = [];
  for (const [mediaId] of pool.entries()) {
    if (!pool.video(mediaId)) continue;
    const c = clock(mediaId);
    states.push({ mediaId, playing: c.playing, time: position(c, now) });
  }
  return states;
}

/** Makes this window's video elements follow the clocks. */
export function followLocal(): void {
  const now = Date.now();
  for (const state of snapshot(now)) {
    const v = pool.video(state.mediaId);
    if (v) followTransport(v, state, now, now);
  }
}

function sync(): void {
  followLocal();
  changed();
}
