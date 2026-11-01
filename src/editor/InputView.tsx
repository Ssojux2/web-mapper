import { useEffect, useRef } from 'react';
import { activeLayer, findSurface, updateLayer, type Quad } from '../core/model';
import { inputMedia, mediaSize, moveInput, selectedLayer } from './actions';
import { editorStore, pool, useEditor, useRuntime } from './context';
import { QuadOverlay } from './QuadOverlay';
import { Transport } from './Transport';
import { Viewport } from './Viewport';

// Overlay items are layers, so their ids carry both the surface and the layer.
const itemId = (surfaceId: string, layerId: string) => `${surfaceId}/${layerId}`;
const splitId = (id: string) => id.split('/') as [string, string];

/** The media of the selected layer, with the input region of every layer that shows it on top. */
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
  const items = project.surfaces.flatMap((s) =>
    s.layers
      .filter((l) => l.mediaId === media.id)
      .map((l) => ({
        id: itemId(s.id, l.id),
        name: s.layers.length > 1 ? `${s.name} · ${l.name}` : s.name,
        quad: toPixels(l.input),
        hidden: !s.visible || !l.visible,
      })),
  );
  const layer = selectedLayer(project, selection);
  const selectedId = selection.surfaceId && layer ? itemId(selection.surfaceId, layer.id) : null;

  return (
    <section className="view" onPointerDownCapture={() => editorStore.getState().setActiveView('input')}>
      <header className="view-header">
        <span className="view-title">Input</span>
        <span className="view-meta">
          {media.name} · {width}×{height}
          {layer && findSurface(project, selection.surfaceId)!.layers.length > 1 && ` · ${layer.name}`}
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
          selectedId={selectedId}
          selectedCorner={selection.corner}
          onSelect={(id, corner) => {
            // Clicking empty media keeps the layer selected so its media stays in view.
            if (!id) return editorStore.getState().select({ corner: null });
            const [surfaceId, layerId] = splitId(id);
            editorStore.getState().select({ surfaceId, layerId, corner });
          }}
          onDrag={(id, corner, _base, d) => {
            const [surfaceId, layerId] = splitId(id);
            const base = editorStore.getState().gestureBase;
            const surface = base && findSurface(base, surfaceId);
            if (!surface) return;
            const input = moveInput(activeLayer(surface, layerId).input, corner, d.x / width, d.y / height);
            editorStore.getState().apply((p) => updateLayer(p, surfaceId, layerId, { input }), { record: false });
          }}
        />
      </Viewport>
    </section>
  );
}
