import { useEffect } from 'react';
import { addQuad, deleteSelected, duplicateSelected, newProject, openProject, restoreAllMedia, saveProject, toggleTestPattern } from './actions';
import { startBridge } from './bridge';
import { editorStore, runtimeStore, useEditor, useRuntime, type RuntimeState } from './context';
import { InputView } from './InputView';
import { Inspector } from './Inspector';
import { installShortcuts } from './keyboard';
import { MediaBin } from './MediaBin';
import { OutputPanel } from './OutputPanel';
import { OutputView } from './OutputView';
import { SurfaceList } from './SurfaceList';
import { currentFileName } from '../project/io';
import { openOutputWindow } from '../output/screens';

const TABS: [RuntimeState['leftTab'], string][] = [
  ['media', 'Media'],
  ['surfaces', 'Surfaces'],
  ['output', 'Output'],
];

function Toolbar() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSelection = useEditor((s) => !!s.selection.surfaceId);
  const testPattern = useEditor((s) => s.project.output.testPattern);
  const output = useRuntime((s) => s.output);
  const store = editorStore.getState();

  return (
    <header className="toolbar">
      <span className="brand">Web Mapper</span>
      <div className="group">
        <button onClick={newProject}>새로</button>
        <button onClick={() => void openProject()} title="Cmd/Ctrl+O">
          열기
        </button>
        <button onClick={() => void saveProject()} title="Cmd/Ctrl+S · 다른 이름: Shift+Cmd/Ctrl+S">
          저장
        </button>
      </div>
      <div className="group">
        <button onClick={addQuad} title="Q">
          + Quad
        </button>
        <button onClick={duplicateSelected} disabled={!hasSelection} title="Cmd/Ctrl+D">
          복제
        </button>
        <button onClick={deleteSelected} disabled={!hasSelection} title="Delete">
          삭제
        </button>
      </div>
      <div className="group">
        <button onClick={store.undo} disabled={!canUndo} title="Cmd/Ctrl+Z">
          ↶
        </button>
        <button onClick={store.redo} disabled={!canRedo} title="Shift+Cmd/Ctrl+Z">
          ↷
        </button>
      </div>
      <div className="group">
        <button className={testPattern ? 'on' : ''} onClick={toggleTestPattern} title="T">
          테스트 패턴
        </button>
        <button
          className="primary"
          onClick={() => {
            const { screens, screenIndex } = runtimeStore.getState();
            openOutputWindow(screens[screenIndex]?.screen);
          }}
        >
          {output ? (output.fullscreen ? '● 출력 중' : '● 출력 창') : '출력 창 열기'}
        </button>
      </div>
      <span className="file-name">{currentFileName()}</span>
    </header>
  );
}

function ReconnectBanner() {
  const statuses = useRuntime((s) => s.mediaStatus);
  const waiting = Object.values(statuses).filter((s) => s === 'needs-permission').length;
  if (waiting === 0) return null;
  return (
    <div className="banner">
      저장된 미디어 {waiting}개를 다시 열려면 파일 접근을 허용해야 합니다.
      <button className="primary" onClick={() => void restoreAllMedia(true)}>
        다시 연결
      </button>
    </div>
  );
}

function Toast() {
  const toast = useRuntime((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast${toast.error ? ' error' : ''}`} role="status">
      {toast.text}
    </div>
  );
}

export function App() {
  const tab = useRuntime((s) => s.leftTab);

  useEffect(() => {
    const stopBridge = startBridge();
    const stopKeys = installShortcuts();
    void restoreAllMedia(false);
    return () => {
      stopBridge();
      stopKeys();
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <aside className="sidebar">
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => runtimeStore.setState({ leftTab: id })}>
              {label}
            </button>
          ))}
        </nav>
        {tab === 'media' && <MediaBin />}
        {tab === 'surfaces' && <SurfaceList />}
        {tab === 'output' && <OutputPanel />}
        <Inspector />
      </aside>
      <main className="views">
        <ReconnectBanner />
        <InputView />
        <OutputView />
      </main>
      <Toast />
    </div>
  );
}
