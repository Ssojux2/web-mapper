import { useState } from 'react';
import { findMedia, moveSurface, updateSurface } from '../core/model';
import { addMediaLayer } from './actions';
import { MEDIA_DRAG_TYPE } from './OutputOverlay';
import { editorStore, useEditor, useRuntime } from './context';

const KIND_ICON = { testcard: '▦', video: '▶', image: '▣', capture: '⦿' } as const;

/**
 * Every surface on the output as a layer, front on top: show/hide, solo, opacity,
 * order and delete without leaving the Output view. Floats over its top-right corner.
 */
export function OutputLayers() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const statuses = useRuntime((s) => s.mediaStatus);
  const [open, setOpen] = useState(true);
  const store = editorStore.getState();
  const rows = project.surfaces.slice().reverse();
  const shown = project.surfaces.filter((s) => s.visible).length;
  const apply = store.apply;

  const solo = (id: string) => {
    const only = project.surfaces.every((s) => s.visible === (s.id === id));
    // Soloing the only visible layer again brings every layer back.
    apply((p) => ({ ...p, surfaces: p.surfaces.map((s) => ({ ...s, visible: only || s.id === id })) }));
  };
  const remove = (id: string) => {
    apply((p) => ({ ...p, surfaces: p.surfaces.filter((s) => s.id !== id) }));
    if (selection.surfaceId === id) store.select({ surfaceId: null });
  };

  return (
    <div
      className={`viewport-controls output-layers${open ? '' : ' closed'}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
      }}
      onDrop={(e) => {
        const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
        if (!mediaId) return;
        e.preventDefault();
        addMediaLayer(mediaId);
      }}
    >
      <header>
        <button className="icon small" title={open ? '패널 접기' : '패널 펼치기'} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="title">레이어</span>
        <span className="meta">
          {shown}/{project.surfaces.length} 표시
        </span>
        {open && (
          <button
            className="small"
            disabled={!selection.mediaId}
            title="Media 탭에서 선택한 미디어를 새 레이어로 출력에 올립니다"
            onClick={() => selection.mediaId && addMediaLayer(selection.mediaId)}
          >
            + 선택 미디어
          </button>
        )}
      </header>
      {open && (
        <ul className="list">
          {rows.map((s, i) => {
            const media = s.layers.map((l) => findMedia(project, l.mediaId)).filter((m) => m !== undefined);
            const live = media.some((m) => m.kind === 'capture' && statuses[m.id] === 'ready');
            return (
              <li
                key={s.id}
                className={`row${s.id === selection.surfaceId ? ' selected' : ''}${s.visible ? '' : ' dim'}`}
                onClick={() => store.select({ surfaceId: s.id, corner: null })}
              >
                <button
                  className="icon small"
                  title={s.visible ? '숨기기' : '보이기'}
                  onClick={(e) => {
                    e.stopPropagation();
                    apply((p) => updateSurface(p, s.id, { visible: !s.visible }));
                  }}
                >
                  {s.visible ? '◉' : '○'}
                </button>
                <span className="kind">{KIND_ICON[media.at(-1)?.kind ?? 'testcard']}</span>
                <span className="name" title={media.map((m) => m.name).join(' + ')}>
                  {s.name}
                  {live && <span className="live" title="실시간 캡처" />}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={s.opacity}
                  title={`불투명도 ${Math.round(s.opacity * 100)}%`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={() => store.beginGesture()}
                  onPointerUp={() => store.endGesture()}
                  onChange={(e) => apply((p) => updateSurface(p, s.id, { opacity: Number(e.target.value) }))}
                />
                <span className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon small" title="이 레이어만 보기 (다시 누르면 모두 보기)" onClick={() => solo(s.id)}>
                    S
                  </button>
                  <button className="icon small" title="앞으로" disabled={i === 0} onClick={() => apply((p) => moveSurface(p, s.id, 1))}>
                    ▲
                  </button>
                  <button
                    className="icon small"
                    title="뒤로"
                    disabled={i === rows.length - 1}
                    onClick={() => apply((p) => moveSurface(p, s.id, -1))}
                  >
                    ▼
                  </button>
                  <button className="icon small" title="레이어 삭제 (미디어는 남습니다)" onClick={() => remove(s.id)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
          {rows.length === 0 && <li className="empty">미디어를 추가하거나 여기로 끌어 놓으면 레이어가 생깁니다.</li>}
        </ul>
      )}
    </div>
  );
}
