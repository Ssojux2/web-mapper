import { useEffect, useState } from 'react';
import type { CaptureSource, ScreenPermission } from '../desktop/api';
import { isDesktop } from '../desktop';
import { setSourceChooser, type SourceChooser } from '../media/capture';

// Desktop app only: the screen/window picker that Chrome would otherwise show.

interface Request {
  load(): Promise<CaptureSource[]>;
  permission: ScreenPermission;
  openSettings(): void;
  resolve(source: CaptureSource | null): void;
}

export function CapturePicker() {
  const [request, setRequest] = useState<Request | null>(null);
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!isDesktop) return;
    const choose: SourceChooser = (opts) => new Promise((resolve) => setRequest({ ...opts, resolve }));
    setSourceChooser(choose);
    return () => setSourceChooser(null);
  }, []);

  useEffect(() => {
    if (!request) return;
    let live = true;
    setSources(null);
    setError(null);
    request
      .load()
      .then((list) => live && setSources(list))
      .catch((err) => live && setError(String(err)));
    return () => {
      live = false;
    };
  }, [request, reloads]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      request.resolve(null);
      setRequest(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request]);

  if (!request) return null;
  const finish = (source: CaptureSource | null) => {
    request.resolve(source);
    setRequest(null);
    setSources(null);
  };
  const screens = sources?.filter((s) => s.kind === 'screen') ?? [];
  const windows = sources?.filter((s) => s.kind === 'window') ?? [];
  const blocked = request.permission !== 'granted';

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && finish(null)}>
      <div className="modal capture-picker" role="dialog" aria-label="캡처할 화면 또는 창 선택">
        <header>
          <h2>캡처할 창 또는 화면</h2>
          <button onClick={() => setReloads((n) => n + 1)}>새로 고침</button>
          <button onClick={() => finish(null)}>취소</button>
        </header>
        {blocked && (
          <div className="capture-warning">
            macOS의 화면 기록 권한이 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 기록에서 Web Mapper를 켠 뒤 앱을 다시 시작하세요.
            <button className="small" onClick={request.openSettings}>
              시스템 설정 열기
            </button>
          </div>
        )}
        {error && <p className="capture-warning">{error}</p>}
        {!sources && !error && <p className="hint">목록을 불러오는 중…</p>}
        {sources && (
          <div className="picker-body">
            <SourceGrid title="창" items={windows} onPick={finish} empty="캡처할 수 있는 창이 없습니다. 유튜브 등 영상을 브라우저 창으로 띄워 두세요." />
            <SourceGrid title="화면" items={screens} onPick={finish} empty="화면을 찾지 못했습니다." />
          </div>
        )}
        <p className="hint">유튜브는 별도 창(가능하면 전체화면 플레이어)으로 띄우고 그 창을 고르세요. 창 테두리는 Input 뷰에서 잘라 냅니다. 출력에는 공유 표시가 나타나지 않습니다.</p>
      </div>
    </div>
  );
}

function SourceGrid({ title, items, onPick, empty }: { title: string; items: CaptureSource[]; onPick(s: CaptureSource): void; empty: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <div className="source-grid">
          {items.map((s) => (
            <button key={s.id} className="source" onClick={() => onPick(s)} title={s.name}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <span className="no-thumb" />}
              <span className="source-name">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
