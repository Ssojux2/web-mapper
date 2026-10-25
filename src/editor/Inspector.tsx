import { findMedia, findSurface, updateSurface } from '../core/model';
import { setCorner } from '../core/geometry';
import { mediaSize, resetInput, setLoop, squareOutput } from './actions';
import { editorStore, useEditor, useRuntime } from './context';
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
        <dd>{media.kind === 'video' ? '영상' : media.kind === 'image' ? '이미지' : '테스트 카드'}</dd>
        <dt>크기</dt>
        <dd>
          {width}×{height}
        </dd>
        {media.kind !== 'testcard' && (
          <>
            <dt>상태</dt>
            <dd>{status === 'ready' ? '사용 가능' : status === 'loading' ? '불러오는 중' : '다시 연결 필요'}</dd>
          </>
        )}
      </dl>
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
