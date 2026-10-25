import { useEffect, useRef } from 'react';
import { setCorner, translateQuad } from '../core/geometry';
import { updateSurface } from '../core/model';
import { Renderer } from '../render/renderer';
import { assignMedia } from './actions';
import { editorStore, pool, toast, useEditor } from './context';
import { QuadOverlay } from './QuadOverlay';
import { Viewport } from './Viewport';

/** Live preview of the projector output with corner-pin handles. */
export function OutputView() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const { width, height } = project.output;
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderer: Renderer | null = null;
    let failed = false;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = canvas.current;
      if (!el || failed) return;
      // (Re)create the renderer if the canvas element was replaced by a remount.
      if (renderer?.canvas !== el) {
        renderer?.dispose();
        try {
          renderer = new Renderer(el);
        } catch (err) {
          failed = true;
          toast((err as Error).message, true);
          return;
        }
        if (import.meta.env.DEV) Object.assign(window, { __mapperPreview: renderer });
      }
      const p = editorStore.getState().project;
      // Preview resolution is capped; geometry stays in output pixels.
      renderer.setSize(p.output.width, p.output.height, 1920);
      renderer.render(p, (id) => pool.get(id));
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, []);

  const items = project.surfaces.map((s) => ({ id: s.id, name: s.name, quad: s.output, hidden: !s.visible }));

  return (
    <section className="view" onPointerDownCapture={() => editorStore.getState().setActiveView('output')}>
      <header className="view-header">
        <span className="view-title">Output</span>
        <span className="view-meta">
          {width}×{height}
          {project.output.testPattern && ' · 테스트 패턴'}
        </span>
      </header>
      <Viewport contentWidth={width} contentHeight={height} onBackgroundPointerDown={() => editorStore.getState().select({ surfaceId: null })}>
        <canvas ref={canvas} className="view-canvas" style={{ width, height }} />
        <QuadOverlay
          width={width}
          height={height}
          items={items}
          selectedId={selection.surfaceId}
          selectedCorner={selection.corner}
          onSelect={(surfaceId, corner) => editorStore.getState().select({ surfaceId, corner })}
          onDrag={(id, corner, base, d) => {
            const output = corner === null ? translateQuad(base, d.x, d.y) : setCorner(base, corner, { x: base[corner].x + d.x, y: base[corner].y + d.y });
            editorStore.getState().apply((p) => updateSurface(p, id, { output }), { record: false });
          }}
          onDropMedia={assignMedia}
        />
      </Viewport>
    </section>
  );
}
