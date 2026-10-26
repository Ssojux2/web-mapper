import { mediaUsage, TESTCARD_ID } from '../core/model';
import { addCapture, addMediaFiles, assignMedia, deleteMedia, relink, restoreAllMedia } from './actions';
import { editorStore, useEditor, useRuntime, type MediaStatus } from './context';
import { MEDIA_DRAG_TYPE } from './OutputOverlay';
import { kindOf } from '../media/library';

const KIND_ICON = { testcard: '▦', video: '▶', image: '▣', capture: '⦿' } as const;
const STATUS_TEXT: Partial<Record<MediaStatus, string>> = {
  loading: '불러오는 중',
  'needs-permission': '권한 필요',
  missing: '파일 없음',
  error: '오류',
};

function statusText(kind: string, status: MediaStatus | undefined): string | undefined {
  if (kind === 'capture' && status === 'missing') return '공유 꺼짐';
  return status && STATUS_TEXT[status];
}

export function MediaBin() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const statuses = useRuntime((s) => s.mediaStatus);

  const onDrop = (e: React.DragEvent) => {
    const files = [...e.dataTransfer.files].filter((f) => kindOf(f));
    if (files.length === 0) return;
    e.preventDefault();
    void addMediaFiles(files.map((file) => ({ file })));
  };

  return (
    <div
      className="panel-list"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="panel-actions">
        <button onClick={() => void addMediaFiles()}>+ 미디어 추가</button>
        <button onClick={() => void addCapture()} title="다른 창이나 화면을 실시간으로 가져옵니다. 유튜브를 별도 창(가능하면 전체화면 플레이어)으로 열고 그 창을 고르세요.">
          + 창/화면 캡처
        </button>
        <button
          disabled={!selection.mediaId || !selection.surfaceId}
          title="선택한 미디어를 선택한 서피스에 적용 (더블클릭도 가능)"
          onClick={() => selection.mediaId && selection.surfaceId && assignMedia(selection.surfaceId, selection.mediaId)}
        >
          선택한 서피스에 적용
        </button>
      </div>
      <ul className="list">
        {project.media.map((m) => {
          const status = m.kind === 'testcard' ? 'ready' : statuses[m.id];
          const broken = status === 'missing' || status === 'error' || status === 'needs-permission';
          return (
            <li
              key={m.id}
              className={`row${selection.mediaId === m.id ? ' selected' : ''}${broken ? ' broken' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
                e.dataTransfer.effectAllowed = 'link';
              }}
              onClick={() => editorStore.getState().select({ mediaId: m.id })}
              onDoubleClick={() => selection.surfaceId && assignMedia(selection.surfaceId, m.id)}
            >
              <span className="kind">{KIND_ICON[m.kind]}</span>
              <span className="name" title={m.name}>
                {m.name}
              </span>
              {statusText(m.kind, status) && <span className="badge warn">{statusText(m.kind, status)}</span>}
              {status === 'needs-permission' && (
                <button className="small" onClick={() => void restoreAllMedia(true)}>
                  허용
                </button>
              )}
              {(status === 'missing' || status === 'error') && (
                <button className="small" onClick={() => void relink(m.id)}>
                  {m.kind === 'capture' ? '다시 선택' : '파일 선택'}
                </button>
              )}
              <span className="badge" title="이 미디어를 쓰는 서피스 수">
                {mediaUsage(project, m.id)}
              </span>
              {m.id !== TESTCARD_ID && (
                <button
                  className="icon small"
                  title="미디어 삭제 (쓰던 서피스는 Test Card로 바뀝니다)"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMedia(m.id);
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="hint">파일을 여기로 끌어다 놓아도 추가됩니다. 미디어를 Output 뷰의 서피스 위에 놓으면 적용됩니다.</p>
      <p className="hint">
        캡처는 ‘창’으로 고르세요. 탭을 고르면 Chrome이 출력 창에도 공유 바를 띄웁니다. 창 테두리는 Input 뷰에서 잘라 내고, Chrome의 공유 알림은 ‘숨기기’로 내리면 됩니다. 실시간 소스라 새로 고치면 “다시 선택”이 필요하고, 출력 창은 “출력 창 열기”로 열어야 캡처가 보입니다.
      </p>
    </div>
  );
}
