import { useRef } from 'react';
import { distance, pointInQuad, quadCenter } from '../core/geometry';
import type { Point, Quad } from '../core/model';
import { editorStore } from './context';
import { contentPoint, useViewScale } from './Viewport';

export interface OverlayItem {
  id: string;
  name: string;
  quad: Quad;
  hidden?: boolean;
}

interface Props {
  width: number;
  height: number;
  /** Back-to-front, like the layer stack. */
  items: OverlayItem[];
  selectedId: string | null;
  selectedCorner: number | null;
  /** Called on every pointer move of a drag with the quad at drag start and the pointer delta. */
  onDrag(id: string, corner: number | null, base: Quad, delta: Point): void;
  onSelect(id: string | null, corner: number | null): void;
}

const CORNER_LABELS = ['1', '2', '3', '4'];

/**
 * SVG layer over the Input view: outlines, corner handles and the pointer logic for selecting,
 * moving a whole quad or dragging one corner. One drag = one undo step.
 */
export function QuadOverlay({ width, height, items, selectedId, selectedCorner, onDrag, onSelect }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const scale = useViewScale();
  const px = 1 / scale; // one screen pixel in content units
  const handleR = 7 * px;

  const hit = (p: Point): { id: string; corner: number | null } | null => {
    const selected = items.find((i) => i.id === selectedId);
    if (selected) {
      // Corner handles of the selected surface win, nearest first.
      let best = -1;
      let bestD = 14 * px;
      selected.quad.forEach((c, i) => {
        const d = distance(c, p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) return { id: selected.id, corner: best };
      if (pointInQuad(p, selected.quad)) return { id: selected.id, corner: null };
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i].hidden && pointInQuad(p, items[i].quad)) return { id: items[i].id, corner: null };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const el = svg.current!;
    const start = contentPoint(e, el, width, height);
    const target = hit(start);
    if (!target) {
      onSelect(null, null);
      return;
    }
    onSelect(target.id, target.corner);
    const base = items.find((i) => i.id === target.id)!.quad;
    const store = editorStore.getState();
    store.beginGesture();
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = contentPoint(ev, el, width, height);
      onDrag(target.id, target.corner, base, { x: p.x - start.x, y: p.y - start.y });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      editorStore.getState().endGesture();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const fontSize = 12 * px;

  return (
    <svg
      ref={svg}
      className="quad-overlay"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
    >
      <rect x={0} y={0} width={width} height={height} className="frame" strokeWidth={px} />
      {items.map((item) => {
        const selected = item.id === selectedId;
        const c = quadCenter(item.quad);
        return (
          <g key={item.id} className={`quad${selected ? ' selected' : ''}${item.hidden ? ' hidden' : ''}`}>
            <polygon points={item.quad.map((p) => `${p.x},${p.y}`).join(' ')} strokeWidth={(selected ? 2 : 1) * px} />
            {selected && (
              <>
                <line x1={item.quad[0].x} y1={item.quad[0].y} x2={item.quad[2].x} y2={item.quad[2].y} className="diag" strokeWidth={px} />
                <line x1={item.quad[1].x} y1={item.quad[1].y} x2={item.quad[3].x} y2={item.quad[3].y} className="diag" strokeWidth={px} />
              </>
            )}
            <text x={c.x} y={c.y} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle" className="label">
              {item.name}
            </text>
            {selected &&
              item.quad.map((p, i) => (
                <g key={i} className={`handle${selectedCorner === i ? ' active' : ''}`}>
                  <circle cx={p.x} cy={p.y} r={handleR} strokeWidth={1.5 * px} />
                  <text x={p.x} y={p.y - handleR * 1.9} fontSize={fontSize * 0.9} textAnchor="middle">
                    {CORNER_LABELS[i]}
                  </text>
                </g>
              ))}
          </g>
        );
      })}
    </svg>
  );
}
