import { useEffect, useRef } from 'react';
import { multiply, squareToQuad, toCssMatrix3d } from '../core/geometry';
import { findSurface } from '../core/model';
import { Renderer } from '../render/renderer';
import { enableMesh, restoreReference, setEditMode } from './actions';
import { editorStore, pool, toast, useEditor, useRuntime, type EditMode } from './context';
import { OutputOverlay } from './OutputOverlay';
import { Viewport } from './Viewport';

const MODES: [EditMode, string, string][] = [
  ['surface', '서피스', 'V'],
  ['mesh', '메시', 'W'],
  ['mask', '마스크', 'M'],
  ['reference', '참조', 'R'],
];

/** One line telling the user what clicking does in the current mode. */
function ModeHint() {
  const mode = useRuntime((s) => s.editMode);
  const surface = useEditor((s) => findSurface(s.project, s.selection.surfaceId));
  const hasMask = useEditor((s) => !!s.selection.maskId);
  let text: React.ReactNode = null;
  if (mode === 'mesh') {
    if (!surface) text = '메시를 편집할 서피스를 선택하세요.';
    else if (!surface.mesh)
      text = (
        <>
          이 서피스에는 메시가 없습니다.
          <button className="small" onClick={() => enableMesh(surface.id)}>
            메시 켜기 (4×4)
          </button>
        </>
      );
    else text = '점을 끌어 곡면에 맞춥니다 · 화살표로 1px 이동 · Delete는 점을 원래 자리로';
  } else if (mode === 'mask') {
    if (!surface) text = '마스크를 그릴 서피스를 먼저 선택하세요.';
    else if (hasMask) text = '점·마스크를 끌어 편집 · Shift+클릭으로 변에 점 추가 · Delete로 점/마스크 삭제 · 빈 곳 클릭은 선택 해제';
    else text = '빈 곳을 클릭해 점을 찍고, 첫 점을 누르거나 Enter로 닫습니다 · Backspace 마지막 점 · Esc 취소';
  } else if (mode === 'reference') {
    text = '참조 사진의 네 코너를 끌어 실제 장면과 맞춥니다 (사진은 출력 창에 나가지 않습니다).';
  }
  return text ? <div className="mode-hint">{text}</div> : null;
}

/** Editor-only photo of the scene, corner-pinned with a CSS homography. */
function ReferenceImage() {
  const ref = useEditor((s) => s.project.output.reference);
  const runtime = useRuntime((s) => s.reference);

  useEffect(() => {
    if (ref && runtime?.key !== ref.fileKey) void restoreReference(false);
  }, [ref, runtime?.key]);

  if (!ref || !ref.visible || !runtime?.url || runtime.key !== ref.fileKey) return null;
  const H = multiply(squareToQuad(ref.quad), [1 / ref.width, 0, 0, 0, 1 / ref.height, 0, 0, 0, 1]);
  return (
    <img
      className="reference-image"
      src={runtime.url}
      alt=""
      draggable={false}
      style={{ width: ref.width, height: ref.height, opacity: ref.opacity, transform: toCssMatrix3d(H) }}
    />
  );
}

/** Live preview of the projector output with the editing overlay. */
export function OutputView() {
  const output = useEditor((s) => s.project.output);
  const mode = useRuntime((s) => s.editMode);
  const { width, height } = output;
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderer: Renderer | null = null;
    let failed = false;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = canvas.current;
      if (!el || failed) return;
      // (Re)create the renderer if the canvas element was replaced by a remount.
      if (renderer?.canvas !== el) {
        renderer?.dispose();
        try {
          renderer = new Renderer(el);
        } catch (err) {
          failed = true;
          toast((err as Error).message, true);
          return;
        }
        if (import.meta.env.DEV) Object.assign(window, { __mapperPreview: renderer });
      }
      const p = editorStore.getState().project;
      // Preview resolution is capped; geometry stays in output pixels.
      renderer.setSize(p.output.width, p.output.height, 1920);
      renderer.render(p, (id) => pool.get(id));
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, []);

  return (
    <section className="view" onPointerDownCapture={() => editorStore.getState().setActiveView('output')}>
      <header className="view-header">
        <span className="view-title">Output</span>
        <span className="view-meta">
          {width}×{height}
          {output.testPattern && ' · 테스트 패턴'}
        </span>
        <div className="mode-switch" role="group" aria-label="편집 모드">
          {MODES.filter(([m]) => m !== 'reference' || output.reference).map(([m, label, key]) => (
            <button key={m} className={mode === m ? 'active' : ''} title={`${label} 편집 (${key})`} onClick={() => setEditMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <ModeHint />
      <Viewport
        contentWidth={width}
        contentHeight={height}
        onBackgroundPointerDown={() => {
          if (mode !== 'mask' && mode !== 'reference') editorStore.getState().select({ surfaceId: null });
        }}
      >
        <canvas ref={canvas} className="view-canvas" style={{ width, height }} />
        <ReferenceImage />
        <OutputOverlay width={width} height={height} />
      </Viewport>
    </section>
  );
}
