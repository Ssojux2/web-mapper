import { createProject, type Project } from '../core/model';
import { SyncChannel, type TransportState } from '../core/sync';
import { MediaPool } from '../media/pool';
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

function updateHint(): void {
  const full = !!document.fullscreenElement;
  document.body.classList.toggle('fullscreen', full);
  hint.hidden = full;
  hint.innerHTML = connected
    ? '<b>클릭하면 전체화면</b><span>F 키로 전환 · 이 창을 프로젝터 화면으로 옮긴 뒤 누르세요</span>'
    : '<b>컨트롤러 연결 대기 중…</b><span>편집기 창에서 “출력 창 열기”를 누르세요</span>';
}

document.addEventListener('fullscreenchange', () => {
  updateHint();
  reportStatus();
});
window.addEventListener('beforeunload', () => sync.post({ type: 'output-closed' }));

// Hide the cursor when the mouse rests, like a dedicated output.
let idleTimer = 0;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 2000);
});

updateHint();
sync.post({ type: 'hello' });
reportStatus();

if (import.meta.env.DEV) {
  Object.assign(window, { __mapperOutput: { renderer, pool, getProject: () => project } });
}
