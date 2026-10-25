import type { TransportState } from '../core/sync';

/**
 * Follows the controller's playback clock. Small drift is absorbed by nudging
 * playbackRate (no visible jump); large drift, pauses and loop wraps seek directly.
 */
export function followTransport(video: HTMLVideoElement, state: TransportState, sentAt: number, now = Date.now()): void {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  let expected = state.playing ? state.time + Math.max(0, now - sentAt) / 1000 : state.time;
  if (duration > 0) expected = video.loop ? expected % duration : Math.min(expected, duration);

  if (state.playing && video.paused && !video.ended) video.play().catch(() => {});
  if (!state.playing && !video.paused) video.pause();

  const d = driftSeconds(video.currentTime, expected, duration, video.loop);
  if (!state.playing) {
    if (Math.abs(d) > 0.02) video.currentTime = expected;
    video.playbackRate = 1;
  } else if (Math.abs(d) > 0.5) {
    video.currentTime = expected;
    video.playbackRate = 1;
  } else if (Math.abs(d) > 0.04) {
    // Ahead → slow down a little, behind → speed up, at most ±10%.
    video.playbackRate = 1 - Math.max(-0.1, Math.min(0.1, d * 0.5));
  } else {
    video.playbackRate = 1;
  }
}

/** Signed drift (positive = ahead), taking the shortest way around a looping video. */
export function driftSeconds(current: number, expected: number, duration: number, loop: boolean): number {
  let d = current - expected;
  if (loop && duration > 0) {
    d = ((d % duration) + duration * 1.5) % duration - duration / 2;
  }
  return d;
}
