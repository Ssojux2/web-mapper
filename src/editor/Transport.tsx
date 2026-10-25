import { useEffect, useState } from 'react';
import { findMedia } from '../core/model';
import { restart, setLoop, togglePlay } from './actions';
import { pool, useEditor } from './context';
import { currentTime, isPlaying, seek } from './playback';

function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Play/pause, restart, loop and seek for a video media item. */
export function Transport({ mediaId }: { mediaId: string }) {
  const media = useEditor((s) => findMedia(s.project, mediaId));
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const video = pool.video(mediaId);
  if (!media || media.kind !== 'video') return null;
  const playing = !!video && isPlaying(mediaId);
  const duration = video?.duration ?? 0;
  const time = video ? currentTime(mediaId) : 0;

  return (
    <div className="transport">
      <button className="icon" title="처음으로" disabled={!video} onClick={() => restart(mediaId)}>
        ⏮
      </button>
      <button className="icon" title="재생/일시정지 (Space)" disabled={!video} onClick={() => togglePlay(mediaId)}>
        {playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={Number.isFinite(duration) ? duration : 0}
        step={0.01}
        value={time}
        disabled={!video}
        onChange={(e) => seek(mediaId, Number(e.target.value))}
      />
      <span className="time">
        {formatTime(time)} / {formatTime(duration)}
      </span>
      <label className="check" title="반복 재생">
        <input type="checkbox" checked={media.loop} onChange={(e) => setLoop(mediaId, e.target.checked)} />
        반복
      </label>
    </div>
  );
}
