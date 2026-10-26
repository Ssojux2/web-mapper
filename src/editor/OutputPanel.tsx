import { closeOutputWindow, listScreens, openOutputWindow, supportsScreenPlacement } from '../output/screens';
import { NumberField } from './NumberField';
import { fitReference, loadReference, restoreReference, setEditMode, setReference, updateReference } from './actions';
import { editorStore, runtimeStore, toast, useEditor, useRuntime } from './context';

const PRESETS: [number, number][] = [
  [1280, 720],
  [1280, 800],
  [1920, 1080],
  [1920, 1200],
  [3840, 2160],
];

function setOutput(patch: Partial<{ width: number; height: number; testPattern: boolean; screenLabel: string }>) {
  editorStore.getState().apply((p) => ({ ...p, output: { ...p.output, ...patch } }));
}

export function OutputPanel() {
  const output = useEditor((s) => s.project.output);
  const screens = useRuntime((s) => s.screens);
  const screenIndex = useRuntime((s) => s.screenIndex);
  const status = useRuntime((s) => s.output);
  const reference = output.reference;
  const referenceStatus = useRuntime((s) => (s.reference?.key === reference?.fileKey ? s.reference?.status : undefined));
  const target = screens[screenIndex];

  const loadScreens = async () => {
    try {
      const list = await listScreens();
      const remembered = list.findIndex((s) => s.label === output.screenLabel);
      const external = list.findIndex((s) => !s.primary);
      runtimeStore.setState({ screens: list, screenIndex: remembered >= 0 ? remembered : external >= 0 ? external : 0 });
      if (list.length < 2) toast('연결된 화면이 하나뿐입니다. 프로젝터를 연결하면 목록에 나타납니다.');
    } catch {
      toast('화면 목록 권한이 거부되었습니다. 주소창의 권한 설정에서 “창 관리”를 허용하세요.', true);
    }
  };

  const open = () => {
    const win = openOutputWindow(target?.screen);
    if (!win) toast('팝업이 차단되었습니다. 주소창에서 이 사이트의 팝업을 허용하세요.', true);
    else if (target) setOutput({ screenLabel: target.label });
  };

  return (
    <div className="panel-list form">
      <h3>해상도</h3>
      <div className="field-row">
        <NumberField label="W" value={output.width} min={16} max={8192} step={1} onCommit={(width) => setOutput({ width: Math.round(width) })} />
        <NumberField label="H" value={output.height} min={16} max={8192} step={1} onCommit={(height) => setOutput({ height: Math.round(height) })} />
      </div>
      <div className="field-row">
        <select
          value=""
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            if (w && h) setOutput({ width: w, height: h });
          }}
        >
          <option value="">프리셋…</option>
          {PRESETS.map(([w, h]) => (
            <option key={`${w}x${h}`} value={`${w}x${h}`}>
              {w}×{h}
            </option>
          ))}
        </select>
        <button
          disabled={!target && !status?.width}
          title="출력 해상도를 프로젝터 화면의 실제 픽셀 크기로 맞춥니다"
          onClick={() => {
            const w = target?.pixelWidth ?? status?.width;
            const h = target?.pixelHeight ?? status?.height;
            if (w && h) setOutput({ width: w, height: h });
          }}
        >
          화면에 맞추기
        </button>
      </div>
      <p className="hint">해상도를 바꿔도 서피스 좌표는 그대로입니다. 프로젝터의 기본 해상도와 맞추는 것이 좋습니다.</p>

      <h3>출력 창</h3>
      {supportsScreenPlacement ? (
        <>
          <div className="field-row">
            <select
              value={screenIndex}
              disabled={screens.length === 0}
              onChange={(e) => runtimeStore.setState({ screenIndex: Number(e.target.value) })}
            >
              {screens.length === 0 && <option value={-1}>화면 목록을 불러오세요</option>}
              {screens.map((s, i) => (
                <option key={i} value={i}>
                  {s.label} · {s.pixelWidth}×{s.pixelHeight}
                  {s.primary ? ' (주 화면)' : ''}
                </option>
              ))}
            </select>
            <button onClick={() => void loadScreens()}>화면 목록</button>
          </div>
        </>
      ) : (
        <p className="hint">
          이 브라우저는 화면 자동 배치를 지원하지 않습니다. 출력 창을 연 뒤 프로젝터 화면으로 끌어 옮기고, 창 안을 클릭해 전체화면으로 바꾸세요. Chrome·Edge에서는 자동으로 배치됩니다.
        </p>
      )}
      <div className="field-row">
        <button className="primary" onClick={open}>
          {status ? '출력 창 앞으로' : '출력 창 열기'}
        </button>
        {status && <button onClick={closeOutputWindow}>닫기</button>}
      </div>
      <p className={`status-line${status ? ' ok' : ''}`}>
        {status ? (status.fullscreen ? '● 출력 중 (전체화면)' : '● 연결됨 · 출력 창을 클릭하면 전체화면') : '○ 출력 창 없음'}
      </p>
      <p className="hint">출력 창의 안내문과 커서는 마우스를 멈추면 사라집니다. 캡처를 쓸 때 탭을 공유하면 Chrome의 공유 바가 출력에도 보이니, ‘창’으로 공유하세요.</p>

      <h3>참조 이미지</h3>
      {reference ? (
        <>
          <div className="field-row">
            <span className="ref-name" title={reference.name}>
              {reference.name}
            </span>
            {referenceStatus === 'needs-permission' && (
              <button className="small" onClick={() => void restoreReference(true)}>
                허용
              </button>
            )}
            {referenceStatus === 'missing' && <span className="badge warn">파일 없음</span>}
          </div>
          <label className="field">
            <span>불투명도</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={reference.opacity}
              onPointerDown={() => editorStore.getState().beginGesture()}
              onPointerUp={() => editorStore.getState().endGesture()}
              onChange={(e) => updateReference({ opacity: Number(e.target.value) })}
            />
            <span className="value">{Math.round(reference.opacity * 100)}%</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={reference.visible} onChange={(e) => updateReference({ visible: e.target.checked })} />
            보이기
          </label>
          <div className="field-row">
            <button onClick={() => setEditMode('reference')} title="R">
              코너 맞추기
            </button>
            <button onClick={fitReference}>출력 전체로</button>
            <button onClick={() => void loadReference()}>바꾸기</button>
            <button className="icon" title="참조 이미지 제거" onClick={() => setReference(undefined)}>
              ✕
            </button>
          </div>
        </>
      ) : (
        <button onClick={() => void loadReference()}>참조 이미지 불러오기</button>
      )}
      <p className="hint">
        프로젝터 자리에서 찍은 사진을 깔고 마스크를 따라 그립니다. 테스트 패턴을 켠 채로 찍으면, 사진 속 격자 테두리가 출력 테두리와 맞도록 코너를 끌어 정렬할 수 있습니다. 편집기에만 보이고 출력 창에는 나가지 않습니다.
      </p>

      <h3>보조</h3>
      <label className="check">
        <input type="checkbox" checked={output.testPattern} onChange={(e) => setOutput({ testPattern: e.target.checked })} />
        테스트 패턴 (T)
      </label>
      <p className="hint">프로젝터 초점·위치를 맞출 때 쓰는 격자입니다. 켜져 있는 동안에는 서피스 대신 격자가 나옵니다.</p>
    </div>
  );
}
