import { useState } from 'react';
import { findMedia, updateSurface } from '../core/model';
import { addQuad, deleteSelected, duplicateSelected, moveLayer } from './actions';
import { editorStore, useEditor } from './context';

/** Layer stack, front surface at the top as in MadMapper. */
export function SurfaceList() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selection.surfaceId);
  const [editing, setEditing] = useState<string | null>(null);
  const rows = project.surfaces.slice().reverse();

  const rename = (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) editorStore.getState().apply((p) => updateSurface(p, id, { name: trimmed }));
    setEditing(null);
  };

  return (
    <div className="panel-list">
      <div className="panel-actions">
        <button onClick={addQuad} title="Quad 추가 (Q)">
          + Quad
        </button>
        <button onClick={duplicateSelected} disabled={!selectedId} title="복제 (Cmd/Ctrl+D)">
          복제
        </button>
        <button onClick={deleteSelected} disabled={!selectedId} title="삭제 (Delete)">
          삭제
        </button>
        <button className="icon" onClick={() => moveLayer(1)} disabled={!selectedId} title="앞으로 (Cmd/Ctrl+])">
          ▲
        </button>
        <button className="icon" onClick={() => moveLayer(-1)} disabled={!selectedId} title="뒤로 (Cmd/Ctrl+[)">
          ▼
        </button>
      </div>
      <ul className="list">
        {rows.map((s) => (
          <li
            key={s.id}
            className={`row${s.id === selectedId ? ' selected' : ''}${s.visible ? '' : ' dim'}`}
            onClick={() => editorStore.getState().select({ surfaceId: s.id, corner: null })}
            onDoubleClick={() => setEditing(s.id)}
          >
            <button
              className="icon small"
              title={s.visible ? '숨기기' : '보이기'}
              onClick={(e) => {
                e.stopPropagation();
                editorStore.getState().apply((p) => updateSurface(p, s.id, { visible: !s.visible }));
              }}
            >
              {s.visible ? '◉' : '○'}
            </button>
            {editing === s.id ? (
              <input
                className="rename"
                autoFocus
                defaultValue={s.name}
                onBlur={(e) => rename(s.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename(s.id, e.currentTarget.value);
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <span className="name">{s.name}</span>
            )}
            <span className="sub">{findMedia(project, s.mediaId)?.name}</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="hint">서피스가 없습니다. “+ Quad”를 눌러 추가하세요.</p>}
      <p className="hint">이름을 바꾸려면 더블클릭하세요. 위에 있는 서피스가 앞에 그려집니다.</p>
    </div>
  );
}
