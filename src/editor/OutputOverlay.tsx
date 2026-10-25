import { useEffect, useRef, useState } from 'react';
import { distance, pointInQuad, quadCenter, setCorner, translateQuad } from '../core/geometry';
import { isMeshCorner, meshControlPoints, pointInPolygon, segmentDistance, surfaceGeometry, surfacePoint } from '../core/mesh';
import { findSurface, translateSurface, updateMask, updateSurface, type Mask, type Point, type Surface } from '../core/model';
import { addMask, assignMedia, insertMaskPoint, updateReference } from './actions';
import { editorStore, useEditor, useRuntime } from './context';
import { contentPoint, useViewScale } from './Viewport';

export const MEDIA_DRAG_TYPE = 'application/x-mapper-media';

const CORNER_LABELS = ['1', '2', '3', '4'];

const store = () => editorStore.getState();

/** The surface as it was when the current drag started (drags are applied from there). */
function baseSurface(id: string): Surface | undefined {
  return store().gestureBase?.surfaces.find((s) => s.id === id);
}

function points(pts: Point[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * SVG layer over the Output view. What a drag edits depends on the edit mode:
 * surface (corner pin, move), mesh (warp points), mask (draw/edit polygons) or
 * reference (corner-pin the reference photo).
 */
export function OutputOverlay({ width, height }: { width: number; height: number }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const mode = useRuntime((s) => s.editMode);
  const svg = useRef<SVGSVGElement>(null);
  const px = 1 / useViewScale(); // one screen pixel in content units
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const selected = findSurface(project, selection.surfaceId);
  const reference = project.output.reference;

  // A mask being drawn belongs to one surface and mode; drop it when either changes.
  const draftOwner = `${mode}:${selection.surfaceId}`;
  const [draftFor, setDraftFor] = useState(draftOwner);
  if (draftFor !== draftOwner) {
    setDraftFor(draftOwner);
    setDraft(null);
  }

  const finishDraft = (pts: Point[] | null) => {
    if (pts && pts.length >= 3 && selected) addMask(selected.id, pts);
    setDraft(null);
  };
  const latest = useRef({ draft, finishDraft });
  latest.current = { draft, finishDraft };

  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      const { draft: d, finishDraft: finish } = latest.current;
      if (e.key === 'Enter') finish(d);
      else if (e.key === 'Escape') setDraft(null);
      else if (e.key === 'Backspace' || e.key === 'Delete') setDraft(d && d.length > 1 ? d.slice(0, -1) : null);
      else return;
      // Keep the editor shortcuts (deselect, delete surface) from also firing.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft]);

  const toContent = (e: { clientX: number; clientY: number }) => contentPoint(e, svg.current!, width, height);

  /** Starts a drag: `onMove` gets the pointer delta from the press point; one undo step. */
  const drag = (e: React.PointerEvent, onMove: (d: Point) => void) => {
    const el = svg.current!;
    const start = toContent(e);
    store().beginGesture();
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = toContent(ev);
      onMove({ x: p.x - start.x, y: p.y - start.y });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      store().endGesture();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const nearest = (p: Point, candidates: Point[], radius: number): number => {
    let best = -1;
    let bestD = radius;
    candidates.forEach((c, i) => {
      const d = distance(c, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const topSurfaceAt = (p: Point): Surface | undefined => {
    for (let i = project.surfaces.length - 1; i >= 0; i--) {
      const s = project.surfaces[i];
      if (s.visible && pointInPolygon(p, surfaceGeometry(s).outline)) return s;
    }
    return undefined;
  };

  const moveSurfaceDrag = (e: React.PointerEvent, id: string) =>
    drag(e, (d) => {
      const base = baseSurface(id);
      if (base) store().apply((p) => updateSurface(p, id, translateSurface(base, d.x, d.y)), { record: false });
    });

  const onReferenceDown = (e: React.PointerEvent, p: Point) => {
    if (!reference) return;
    const corner = nearest(p, reference.quad, 14 * px);
    const base = reference.quad;
    if (corner >= 0) {
      drag(e, (d) => updateReferenceLive({ quad: setCorner(base, corner, { x: base[corner].x + d.x, y: base[corner].y + d.y }) }));
    } else if (pointInQuad(p, reference.quad)) {
      drag(e, (d) => updateReferenceLive({ quad: translateQuad(base, d.x, d.y) }));
    }
  };

  const onMaskDown = (e: React.PointerEvent, p: Point, surface: Surface) => {
    if (draft) {
      if (draft.length >= 3 && distance(p, draft[0]) < 12 * px) finishDraft(draft);
      else setDraft([...draft, p]);
      return;
    }
    const sel = surface.masks.find((m) => m.id === selection.maskId);

    // Shift+click on an edge of the selected mask inserts a point there.
    if (sel && e.shiftKey) {
      let best = { d: 10 * px, i: -1 };
      sel.points.forEach((a, i) => {
        const { d } = segmentDistance(p, a, sel.points[(i + 1) % sel.points.length]);
        if (d < best.d) best = { d, i };
      });
      if (best.i >= 0) {
        insertMaskPoint(surface.id, sel.id, best.i, p);
        dragMaskPoint(e, surface.id, sel.id, best.i + 1);
        return;
      }
    }

    // Points: the selected mask first, then the others (topmost first).
    const order = [...(sel ? [sel] : []), ...surface.masks.filter((m) => m !== sel).reverse()];
    for (const m of order) {
      const i = nearest(p, m.points, 10 * px);
      if (i >= 0) {
        store().select({ maskId: m.id, maskPoint: i });
        dragMaskPoint(e, surface.id, m.id, i);
        return;
      }
    }
    for (const m of order) {
      if (pointInPolygon(p, m.points)) {
        store().select({ maskId: m.id, maskPoint: null });
        drag(e, (d) => {
          const base = baseSurface(surface.id)?.masks.find((x) => x.id === m.id);
          if (!base) return;
          const moved = base.points.map((q) => ({ x: q.x + d.x, y: q.y + d.y }));
          store().apply((pr) => updateMask(pr, surface.id, m.id, { points: moved }), { record: false });
        });
        return;
      }
    }
    // Empty spot: first click deselects the mask, otherwise it starts a new one.
    if (sel) store().select({ maskId: null, maskPoint: null });
    else setDraft([p]);
  };

  const dragMaskPoint = (e: React.PointerEvent, surfaceId: string, maskId: string, index: number) =>
    drag(e, (d) => {
      const base = baseSurface(surfaceId)?.masks.find((x) => x.id === maskId);
      const bp = base?.points[index];
      if (!base || !bp) return;
      const moved = base.points.map((q, i) => (i === index ? { x: bp.x + d.x, y: bp.y + d.y } : q));
      store().apply((pr) => updateMask(pr, surfaceId, maskId, { points: moved }), { record: false });
    });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toContent(e);

    if (mode === 'reference') return onReferenceDown(e, p);
    if (mode === 'mask') {
      if (selected) return onMaskDown(e, p, selected);
      const s = topSurfaceAt(p);
      store().select({ surfaceId: s?.id ?? null });
      return;
    }

    if (selected) {
      const corner = nearest(p, selected.output, 14 * px);
      if (corner >= 0) {
        store().select({ corner, point: null });
        drag(e, (d) => {
          const base = baseSurface(selected.id);
          if (!base) return;
          const output = setCorner(base.output, corner, { x: base.output[corner].x + d.x, y: base.output[corner].y + d.y });
          store().apply((pr) => updateSurface(pr, selected.id, { output }), { record: false });
        });
        return;
      }
      if (mode === 'mesh' && selected.mesh) {
        const mesh = selected.mesh;
        const pts = meshControlPoints(selected);
        const i = nearest(p, pts, 10 * px);
        if (i >= 0 && !isMeshCorner(mesh, i)) {
          store().select({ point: i, corner: null });
          drag(e, (d) => {
            const base = baseSurface(selected.id)?.mesh;
            if (!base) return;
            const offsets = base.offsets.map((o, k) => (k === i ? { x: o.x + d.x, y: o.y + d.y } : o));
            store().apply((pr) => updateSurface(pr, selected.id, { mesh: { ...base, offsets } }), { record: false });
          });
          return;
        }
      }
      if (pointInPolygon(p, surfaceGeometry(selected).outline)) {
        store().select({ corner: null, point: null });
        moveSurfaceDrag(e, selected.id);
        return;
      }
    }
    const hit = topSurfaceAt(p);
    if (hit) {
      store().select({ surfaceId: hit.id });
      moveSurfaceDrag(e, hit.id);
    } else {
      store().select({ surfaceId: null });
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (!mediaId) return;
    e.preventDefault();
    const hit = topSurfaceAt(toContent(e));
    if (hit) {
      assignMedia(hit.id, mediaId);
      store().select({ surfaceId: hit.id });
    }
  };

  const fontSize = 12 * px;
  const handleR = 7 * px;

  return (
    <svg
      ref={svg}
      className={`quad-overlay mode-${mode}${draft ? ' drawing' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => draft && setHover(toContent(e))}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <rect x={0} y={0} width={width} height={height} className="frame" strokeWidth={px} />

      {project.surfaces.map((s) => {
        const isSel = s.id === selection.surfaceId;
        const c = quadCenter(s.output);
        return (
          <g key={s.id} className={`quad${isSel ? ' selected' : ''}${s.visible ? '' : ' hidden'}`}>
            <polygon points={points(surfaceGeometry(s).outline)} strokeWidth={(isSel ? 2 : 1) * px} />
            <text x={c.x} y={c.y} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle" className="label">
              {s.name}
            </text>
          </g>
        );
      })}

      {selected && mode !== 'reference' && (
        <MaskShapes surface={selected} active={mode === 'mask'} selectedMask={selection.maskId} selectedPoint={selection.maskPoint} px={px} />
      )}

      {selected && mode === 'mesh' && selected.mesh && <MeshGrid surface={selected} selectedPoint={selection.point} px={px} />}

      {selected && (mode === 'surface' || mode === 'mesh') && (
        <g className="quad selected">
          {mode === 'surface' && !selected.mesh && (
            <>
              <line x1={selected.output[0].x} y1={selected.output[0].y} x2={selected.output[2].x} y2={selected.output[2].y} className="diag" strokeWidth={px} />
              <line x1={selected.output[1].x} y1={selected.output[1].y} x2={selected.output[3].x} y2={selected.output[3].y} className="diag" strokeWidth={px} />
            </>
          )}
          {selected.output.map((p, i) => (
            <g key={i} className={`handle${selection.corner === i ? ' active' : ''}`}>
              <circle cx={p.x} cy={p.y} r={handleR} strokeWidth={1.5 * px} />
              <text x={p.x} y={p.y - handleR * 1.9} fontSize={fontSize * 0.9} textAnchor="middle">
                {CORNER_LABELS[i]}
              </text>
            </g>
          ))}
        </g>
      )}

      {draft && (
        <g className="mask-draft">
          <polyline points={points(hover ? [...draft, hover] : draft)} strokeWidth={1.5 * px} />
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 6 : 4) * px} strokeWidth={1.5 * px} className={i === 0 ? 'first' : ''} />
          ))}
        </g>
      )}

      {mode === 'reference' && reference && (
        <g className="reference-handles">
          <polygon points={points(reference.quad)} strokeWidth={1.5 * px} />
          {reference.quad.map((p, i) => (
            <g key={i} className="handle">
              <circle cx={p.x} cy={p.y} r={handleR} strokeWidth={1.5 * px} />
              <text x={p.x} y={p.y - handleR * 1.9} fontSize={fontSize * 0.9} textAnchor="middle">
                {CORNER_LABELS[i]}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/** Reference edits during a drag: no undo entry per move (the gesture records one). */
function updateReferenceLive(patch: Parameters<typeof updateReference>[0]) {
  const ref = store().project.output.reference;
  if (ref) store().apply((p) => ({ ...p, output: { ...p.output, reference: { ...ref, ...patch } } }), { record: false });
}

function MaskShapes(props: { surface: Surface; active: boolean; selectedMask: string | null; selectedPoint: number | null; px: number }) {
  const { surface, active, selectedMask, selectedPoint, px } = props;
  return (
    <g className={`masks${active ? ' active' : ''}`}>
      {surface.masks.map((m: Mask) => {
        const isSel = active && m.id === selectedMask;
        return (
          <g key={m.id} className={`mask${m.invert ? ' invert' : ''}${m.enabled ? '' : ' disabled'}${isSel ? ' selected' : ''}`}>
            <polygon points={points(m.points)} strokeWidth={(isSel ? 2 : 1.2) * px} />
            {active &&
              m.points.map((p, i) => (
                <rect
                  key={i}
                  className={`mask-point${isSel && selectedPoint === i ? ' active' : ''}`}
                  x={p.x - 4 * px}
                  y={p.y - 4 * px}
                  width={8 * px}
                  height={8 * px}
                  strokeWidth={1.2 * px}
                />
              ))}
          </g>
        );
      })}
    </g>
  );
}

function MeshGrid({ surface, selectedPoint, px }: { surface: Surface; selectedPoint: number | null; px: number }) {
  const mesh = surface.mesh!;
  const steps = 8;
  const lines: Point[][] = [];
  for (let j = 0; j <= mesh.rows; j++) {
    const line: Point[] = [];
    for (let k = 0; k <= mesh.cols * steps; k++) line.push(surfacePoint(surface, k / (mesh.cols * steps), j / mesh.rows));
    lines.push(line);
  }
  for (let i = 0; i <= mesh.cols; i++) {
    const line: Point[] = [];
    for (let k = 0; k <= mesh.rows * steps; k++) line.push(surfacePoint(surface, i / mesh.cols, k / (mesh.rows * steps)));
    lines.push(line);
  }
  const pts = meshControlPoints(surface);
  return (
    <g className="mesh">
      {lines.map((l, i) => (
        <polyline key={i} points={points(l)} strokeWidth={px} />
      ))}
      {pts.map((p, i) =>
        isMeshCorner(mesh, i) ? null : (
          <rect
            key={i}
            className={`mesh-point${selectedPoint === i ? ' active' : ''}`}
            x={p.x - 4 * px}
            y={p.y - 4 * px}
            width={8 * px}
            height={8 * px}
            strokeWidth={1.2 * px}
          />
        ),
      )}
    </g>
  );
}
