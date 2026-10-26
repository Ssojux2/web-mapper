import { createProject, type Project } from '../core/model';
import { SyncChannel, type TransportState } from '../core/sync';
import { captureFromOpener, hasOpener } from '../media/capture';
import { MediaPool } from '../media/pool';
import { registerServiceWorker } from '../pwa';
import { Renderer } from '../render/renderer';
import { followTransport } from './transportSync';

// Output window: receives the project from the controller, renders it at the output
// resolution and plays its own copies of the media in step with the controller.

const canvas = document.getElementById('out') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLDivElement;
const renderer = new Renderer(canvas);
const pool = new MediaPool();
const sync = new SyncChannel();

let project: Project = { ...createProject(), surfaces: [] };
let connected = false;
let lastTransport: { states: TransportState[]; sentAt: number } | null = null;

sync.on((msg) => {
  switch (msg.type) {
    case 'controller-hello':
      reportStatus();
      break;
    case 'project':
      project = msg.project;
      connected = true;
      for (const m of project.media) pool.setLoop(m.id, m.loop);
      syncCaptures();
      updateHint();
      break;
    case 'media-file': {
      const loop = project.media.find((m) => m.id === msg.mediaId)?.loop ?? true;
      pool
        .setFile(msg.mediaId, msg.file, msg.kind, loop)
        .then(() => applyTransport())
        .catch((err) => console.error(err));
      break;
    }
    case 'transport':
      lastTransport = { states: msg.states, sentAt: msg.sentAt };
      applyTransport();
      break;
  }
});

// Captures are borrowed from the editor window. Checked on every project update and
// periodically, because re-picking a capture swaps the stream without a project change.
const pendingCaptures = new Set<string>();
let captureUnavailable = false;

function syncCaptures(): void {
  const captures = project.media.filter((m) => m.kind === 'capture');
  captureUnavailable = captures.length > 0 && !hasOpener();
  for (const m of captures) {
    const stream = captureFromOpener(m.id);
    if (!stream || stream === pool.stream(m.id) || pendingCaptures.has(m.id)) continue;
    pendingCaptures.add(m.id);
    pool
      .setStream(m.id, stream)
      .catch((err) => console.error(err))
      .finally(() => pendingCaptures.delete(m.id));
  }
}
setInterval(() => {
  const was = captureUnavailable;
  syncCaptures();
  if (was !== captureUnavailable) updateHint();
}, 1000);

function applyTransport(): void {
  if (!lastTransport) return;
  for (const state of lastTransport.states) {
    const video = pool.video(state.mediaId);
    if (video) followTransport(video, state, lastTransport.sentAt);
  }
}

function frame(): void {
  renderer.setSize(project.output.width, project.output.height);
  renderer.render(project, (id) => pool.get(id));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Fullscreen needs a user gesture inside this window: a click or the F key.
function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
document.addEventListener('click', () => {
  if (!document.fullscreenElement) toggleFullscreen();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});

function reportStatus(): void {
  sync.post({
    type: 'output-status',
    fullscreen: !!document.fullscreenElement,
    width: Math.round(screen.width * devicePixelRatio),
    height: Math.round(screen.height * devicePixelRatio),
  });
}

// The hint never stays on the projected image: hidden in fullscreen, and otherwise
// only shown while the mouse moves (it fades out after a short rest).
let idle = false;

function updateHint(): void {
  const full = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen', full);
  hint.classList.toggle('hide', full || idle);
  hint.innerHTML = connected
    ? '<b>클릭하면 전체화면 (F)</b><span>이 창을 프로젝터 화면으로 옮긴 뒤 누르세요 · 마우스를 멈추면 안내가 사라집니다</span>'
    : '<b>컨트롤러 연결 대기 중…</b><span>편집기 창에서 “출력 창 열기”를 누르세요</span>';
  if (captureUnavailable) {
    hint.innerHTML += '<span class="warn">화면 캡처는 편집기의 “출력 창 열기”로 연 창에서만 보입니다</span>';
  }
}

document.addEventListener('fullscreenchange', () => {
  updateHint();
  reportStatus();
});
window.addEventListener('beforeunload', () => sync.post({ type: 'output-closed' }));

// When the mouse rests, hide the cursor and the hint, like a dedicated output.
let idleTimer = 0;
function wake(): void {
  if (idle) {
    idle = false;
    document.body.classList.remove('idle');
    updateHint();
  }
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    idle = true;
    document.body.classList.add('idle');
    updateHint();
  }, 2500);
}
document.addEventListener('mousemove', wake);

registerServiceWorker();
updateHint();
wake();
sync.post({ type: 'hello' });
reportStatus();

if (import.meta.env.DEV) {
  Object.assign(window, { __mapperOutput: { renderer, pool, getProject: () => project } });
}
