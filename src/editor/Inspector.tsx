import { findMedia, findSurface, MAX_MESH_DIVISIONS, updateSurface, type Surface } from '../core/model';
import { setCorner } from '../core/geometry';
import { addRectMask, enableMesh, flattenMesh, mediaSize, recapture, removeMask, removeMesh, resetInput, setEditMode, setLoop, setMask, setMeshSize, setMeshSmooth, squareOutput, TAB_CAPTURE_WARNING } from './actions';
import { editorStore, pool, runtimeStore, useEditor, useRuntime } from './context';
import { isTabCapture } from '../media/capture';
import { NumberField } from './NumberField';

const CORNER_NAMES = ['1 좌상', '2 우상', '3 우하', '4 좌하'];

function SurfaceInspector({ surfaceId }: { surfaceId: string }) {
  const project = useEditor((s) => s.project);
  const corner = useEditor((s) => s.selection.corner);
  const surface = findSurface(project, surfaceId);
  if (!surface) return null;
  const apply = editorStore.getState().apply;

  return (
    <div className="inspector-section">
      <h3>서피스 · {surface.name}</h3>
      <label className="field">
        <span>미디어</span>
        <select value={surface.mediaId} onChange={(e) => apply((p) => updateSurface(p, surface.id, { mediaId: e.target.value }))}>
          {project.media.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>불투명도</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={surface.opacity}
          onPointerDown={() => editorStore.getState().beginGesture()}
          onPointerUp={() => editorStore.getState().endGesture()}
          onChange={(e) => apply((p) => updateSurface(p, surface.id, { opacity: Number(e.target.value) }))}
        />
        <span className="value">{Math.round(surface.opacity * 100)}%</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={surface.visible} onChange={(e) => apply((p) => updateSurface(p, surface.id, { visible: e.target.checked }))} />
        보이기
      </label>

      <h4>출력 코너 (px)</h4>
      {surface.output.map((p, i) => (
        <div key={i} className={`field-row corner${corner === i ? ' active' : ''}`} onClick={() => editorStore.getState().select({ corner: i })}>
          <span className="corner-name">{CORNER_NAMES[i]}</span>
          <NumberField label="X" value={p.x} digits={1} step={1} onCommit={(x) => apply((pr) => updateSurface(pr, surface.id, { output: setCorner(surface.output, i, { x, y: p.y }) }))} />
          <NumberField label="Y" value={p.y} digits={1} step={1} onCommit={(y) => apply((pr) => updateSurface(pr, surface.id, { output: setCorner(surface.output, i, { x: p.x, y }) }))} />
        </div>
      ))}
      <div className="field-row">
        <button onClick={() => squareOutput(surface.id)} title="원근 변형을 풀고 직사각형으로 되돌립니다">
          직사각형으로
        </button>
        <button onClick={() => resetInput(surface.id)} title="입력 영역을 미디어 전체로 되돌립니다">
          입력 전체로
        </button>
      </div>
      <MeshSection surface={surface} />
      <MaskSection surface={surface} />
    </div>
  );
}

function MeshSection({ surface }: { surface: Surface }) {
  const mesh = surface.mesh;
  if (!mesh) {
    return (
      <div className="inspector-section">
        <h4>메시 워프</h4>
        <p className="hint">곡면에 맞추려면 격자를 켜고 “메시” 모드에서 점을 끌어 주세요.</p>
        <button
          onClick={() => {
            enableMesh(surface.id);
            setEditMode('mesh');
          }}
        >
          메시 켜기 (4×4)
        </button>
      </div>
    );
  }
  const clamp = (n: number) => Math.min(MAX_MESH_DIVISIONS, Math.max(1, Math.round(n)));
  return (
    <div className="inspector-section">
      <h4>메시 워프</h4>
      <div className="field-row">
        <NumberField label="가로" value={mesh.cols} min={1} max={MAX_MESH_DIVISIONS} onCommit={(c) => setMeshSize(surface.id, clamp(c), mesh.rows)} />
        <NumberField label="세로" value={mesh.rows} min={1} max={MAX_MESH_DIVISIONS} onCommit={(r) => setMeshSize(surface.id, mesh.cols, clamp(r))} />
      </div>
      <label className="check">
        <input type="checkbox" checked={mesh.smooth} onChange={(e) => setMeshSmooth(surface.id, e.target.checked)} />
        부드러운 곡선
      </label>
      <div className="field-row">
        <button onClick={() => setEditMode('mesh')}>점 편집</button>
        <button onClick={() => flattenMesh(surface.id)} title="모든 점을 원래 격자로 되돌립니다">
          평평하게
        </button>
        <button onClick={() => removeMesh(surface.id)}>메시 끄기</button>
      </div>
    </div>
  );
}

function MaskSection({ surface }: { surface: Surface }) {
  const selectedMask = useEditor((s) => s.selection.maskId);
  const selectMask = (maskId: string) => {
    editorStore.getState().select({ maskId, maskPoint: null });
    runtimeStore.setState({ editMode: 'mask' });
  };
  return (
    <div className="inspector-section">
      <h4>마스크</h4>
      {surface.masks.length === 0 && <p className="hint">마스크가 없으면 서피스 전체가 보입니다.</p>}
      <ul className="list mask-list">
        {surface.masks.map((m) => (
          <li key={m.id} className={`row${m.id === selectedMask ? ' selected' : ''}${m.enabled ? '' : ' dim'}`} onClick={() => selectMask(m.id)}>
            <input
              type="checkbox"
              title="사용"
              checked={m.enabled}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setMask(surface.id, m.id, { enabled: e.target.checked })}
            />
            <span className="name">{m.name}</span>
            <button
              className={`small${m.invert ? ' on' : ''}`}
              title="반전: 안쪽을 가립니다"
              onClick={(e) => {
                e.stopPropagation();
                setMask(surface.id, m.id, { invert: !m.invert });
              }}
            >
              {m.invert ? '가림' : '보임'}
            </button>
            <button
              className="icon small"
              title="마스크 삭제"
              onClick={(e) => {
                e.stopPropagation();
                removeMask(surface.id, m.id);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {surface.masks
        .filter((m) => m.id === selectedMask)
        .map((m) => (
          <div key={m.id} className="field-row">
            <NumberField label="페더(px)" value={m.feather} min={0} max={500} onCommit={(feather) => setMask(surface.id, m.id, { feather })} />
          </div>
        ))}
      <div className="field-row">
        <button
          onClick={() => {
            editorStore.getState().select({ maskId: null, maskPoint: null });
            setEditMode('mask');
          }}
        >
          + 그리기
        </button>
        <button onClick={() => addRectMask(surface.id)}>+ 사각형</button>
      </div>
    </div>
  );
}

function MediaInspector({ mediaId }: { mediaId: string }) {
  const media = useEditor((s) => findMedia(s.project, mediaId));
  const status = useRuntime((s) => s.mediaStatus[mediaId]);
  if (!media) return null;
  const { width, height } = mediaSize(media);
  return (
    <div className="inspector-section">
      <h3>미디어 · {media.name}</h3>
      <dl className="facts">
        <dt>종류</dt>
        <dd>{{ video: '영상', image: '이미지', testcard: '테스트 카드', capture: '화면 캡처 (실시간)' }[media.kind]}</dd>
        <dt>크기</dt>
        <dd>
          {width}×{height}
        </dd>
        {media.kind !== 'testcard' && (
          <>
            <dt>상태</dt>
            <dd>
              {status === 'ready'
                ? '사용 가능'
                : status === 'loading'
                  ? '불러오는 중'
                  : media.kind === 'capture'
                    ? '공유 꺼짐 · 다시 선택 필요'
                    : '다시 연결 필요'}
            </dd>
          </>
        )}
      </dl>
      {media.kind === 'capture' && status === 'ready' && isTabCapture(pool.stream(media.id)) && (
        <div className="capture-warning">
          <p>{TAB_CAPTURE_WARNING}</p>
          <button onClick={() => void recapture(media.id)}>창으로 다시 선택</button>
        </div>
      )}
      {media.kind === 'video' && (
        <label className="check">
          <input type="checkbox" checked={media.loop} onChange={(e) => setLoop(media.id, e.target.checked)} />
          반복 재생
        </label>
      )}
    </div>
  );
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const tab = useRuntime((s) => s.leftTab);
  if (tab === 'output') return null;
  if (tab === 'media' && selection.mediaId) {
    return (
      <aside className="inspector">
        <MediaInspector mediaId={selection.mediaId} />
      </aside>
    );
  }
  if (!selection.surfaceId) {
    return (
      <aside className="inspector">
        <p className="hint">서피스를 선택하면 속성이 여기에 나옵니다.</p>
      </aside>
    );
  }
  return (
    <aside className="inspector">
      <SurfaceInspector surfaceId={selection.surfaceId} />
    </aside>
  );
}
