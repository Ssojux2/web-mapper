import { useEffect, useRef } from 'react';
import { updateSurface, type Quad } from '../core/model';
import { inputMedia, mediaSize, moveInput } from './actions';
import { editorStore, pool, useEditor, useRuntime } from './context';
import { QuadOverlay } from './QuadOverlay';
import { Transport } from './Transport';
import { Viewport } from './Viewport';

/** The media of the selected surface, with each surface's input region on top of it. */
export function InputView() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const media = inputMedia(project, selection);
  const status = useRuntime((s) => s.mediaStatus[media.id]);
  const { width, height } = mediaSize(media);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Read the ref every frame: the canvas element can be replaced by a remount.
      const el = canvas.current;
      const ctx = el?.getContext('2d');
      if (!el || !ctx) return;
      const source = pool.get(media.id);
      const scale = Math.min(1, 1920 / width);
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
      if (source) ctx.drawImage(source, 0, 0, w, h);
      else {
        ctx.fillStyle = '#1a1a1e';
        ctx.fillRect(0, 0, w, h);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [media.id, width, height]);

  const toPixels = (q: Quad): Quad => q.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
  const items = project.surfaces
    .filter((s) => s.mediaId === media.id)
    .map((s) => ({ id: s.id, name: s.name, quad: toPixels(s.input), hidden: !s.visible }));

  return (
    <section className="view" onPointerDownCapture={() => editorStore.getState().setActiveView('input')}>
      <header className="view-header">
        <span className="view-title">Input</span>
        <span className="view-meta">
          {media.name} · {width}×{height}
          {media.kind === 'capture' && status === 'ready' && <em className="live"> · LIVE</em>}
          {status && status !== 'ready' && <em className="warn"> · 연결 안 됨</em>}
        </span>
      </header>
      <Transport mediaId={media.id} />
      <Viewport contentWidth={width} contentHeight={height} onBackgroundPointerDown={() => editorStore.getState().select({ corner: null })}>
        <canvas ref={canvas} className="view-canvas" style={{ width, height }} />
        <QuadOverlay
          width={width}
          height={height}
          items={items}
          selectedId={selection.surfaceId}
          selectedCorner={selection.corner}
          onSelect={(surfaceId, corner) => {
            // Clicking empty media keeps the surface selected so its media stays in view.
            if (surfaceId) editorStore.getState().select({ surfaceId, corner });
            else editorStore.getState().select({ corner: null });
          }}
          onDrag={(id, corner, _base, d) => {
            const base = editorStore.getState().gestureBase?.surfaces.find((s) => s.id === id)?.input;
            if (!base) return;
            const input = moveInput(base, corner, d.x / width, d.y / height);
            editorStore.getState().apply((p) => updateSurface(p, id, { input }), { record: false });
          }}
        />
      </Viewport>
    </section>
  );
}
