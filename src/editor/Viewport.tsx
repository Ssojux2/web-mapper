import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Point } from '../core/model';

/** Screen pixels per content unit, so overlays can keep handles a constant size. */
const ScaleContext = createContext(1);
export const useViewScale = () => useContext(ScaleContext);

export const FIT_EVENT = 'mapper:fit-views';

interface Props {
  contentWidth: number;
  contentHeight: number;
  children: ReactNode;
  /** Pointer down on the empty area around the content. */
  onBackgroundPointerDown?(): void;
}

/**
 * Pan/zoom container. Wheel or two-finger scroll pans, Ctrl/Cmd+wheel or pinch zooms
 * around the cursor, middle- or Alt+drag pans, Cmd/Ctrl+0 or the badge fits the view.
 */
export function Viewport({ contentWidth, contentHeight, children, onBackgroundPointerDown }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = outer.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fit = () => setView({ zoom: 1, x: 0, y: 0 });
    window.addEventListener(FIT_EVENT, fit);
    return () => window.removeEventListener(FIT_EVENT, fit);
  }, []);

  const fitScale = Math.min(box.w / contentWidth, box.h / contentHeight) * 0.94;
  const scale = fitScale * view.zoom;
  const tx = (box.w - contentWidth * scale) / 2 + view.x;
  const ty = (box.h - contentHeight * scale) / 2 + view.y;

  // Wheel needs a non-passive native listener to call preventDefault.
  const latest = useRef({ fitScale, scale, tx, ty, box, contentWidth, contentHeight });
  latest.current = { fitScale, scale, tx, ty, box, contentWidth, contentHeight };
  useEffect(() => {
    const el = outer.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = latest.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const c = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const content = { x: (c.x - l.tx) / l.scale, y: (c.y - l.ty) / l.scale };
        setView((v) => {
          const zoom = Math.min(40, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.01)));
          const s = l.fitScale * zoom;
          return {
            zoom,
            x: c.x - content.x * s - (l.box.w - l.contentWidth * s) / 2,
            y: c.y - content.y * s - (l.box.h - l.contentHeight * s) / 2,
          };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!(e.button === 1 || (e.button === 0 && e.altKey))) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div
      ref={outer}
      className="viewport"
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={(e) => {
        if (e.target === outer.current && e.button === 0) onBackgroundPointerDown?.();
      }}
    >
      <div
        className="viewport-content"
        style={{ width: contentWidth, height: contentHeight, transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
      >
        <ScaleContext.Provider value={scale}>{children}</ScaleContext.Provider>
      </div>
      <button className="zoom-badge" title="화면에 맞추기 (Cmd/Ctrl+0)" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
        {Math.round(scale * 100)}%
      </button>
    </div>
  );
}

/** Converts a pointer event to content coordinates of the element it is relative to. */
export function contentPoint(e: { clientX: number; clientY: number }, el: Element, contentWidth: number, contentHeight: number): Point {
  const rect = el.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * contentWidth,
    y: ((e.clientY - rect.top) / rect.height) * contentHeight,
  };
}
