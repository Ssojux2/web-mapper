import { cloneQuad, createId, createProject, createSurface, findMedia, findSurface, FULL_INPUT, moveSurface, rectQuad, removeMedia, TESTCARD_ID, updateMedia, updateSurface, type Media, type Project, type Quad } from '../core/model';
import { setCorner, translateQuad } from '../core/geometry';
import { importMedia, pickMediaFiles, relinkMedia, restoreMedia, type PickedFile } from '../media/library';
import { openProjectFile, resetCurrentFile, saveProjectFile } from '../project/io';
import { editorStore, pool, runtimeStore, setMediaStatus, toast } from './context';
import * as playback from './playback';

// Editor commands shared by the toolbar, panels and keyboard shortcuts.

const state = () => editorStore.getState();

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function selectedSurface() {
  const { project, selection } = state();
  return findSurface(project, selection.surfaceId);
}

/** Media shown in the Input view: the selected surface's, else the one focused in the bin. */
export function inputMedia(project: Project, selection = state().selection): Media {
  const surface = findSurface(project, selection.surfaceId);
  return (
    findMedia(project, surface?.mediaId ?? '') ?? findMedia(project, selection.mediaId ?? '') ?? findMedia(project, TESTCARD_ID)!
  );
}

/** Pixel size of a media item, from the project or the live element. */
export function mediaSize(media: Media): { width: number; height: number } {
  if (media.width > 0 && media.height > 0) return { width: media.width, height: media.height };
  const el = pool.get(media.id);
  if (el instanceof HTMLVideoElement && el.videoWidth) return { width: el.videoWidth, height: el.videoHeight };
  if (el instanceof HTMLImageElement && el.naturalWidth) return { width: el.naturalWidth, height: el.naturalHeight };
  return { width: 1920, height: 1080 };
}

export function addQuad(): void {
  const { project, selection } = state();
  const media =
    findMedia(project, selection.mediaId ?? '') ?? findMedia(project, selectedSurface()?.mediaId ?? '') ?? project.media[0];
  const surface = createSurface(project, media);
  state().apply((p) => ({ ...p, surfaces: [...p.surfaces, surface] }));
  state().select({ surfaceId: surface.id, corner: null });
}

export function duplicateSelected(): void {
  const src = selectedSurface();
  if (!src) return;
  const copy = {
    ...src,
    id: createId('surface'),
    name: `${src.name} 복사본`,
    input: cloneQuad(src.input),
    output: translateQuad(src.output, 24, 24),
  };
  state().apply((p) => {
    const i = p.surfaces.findIndex((s) => s.id === src.id);
    const surfaces = p.surfaces.slice();
    surfaces.splice(i + 1, 0, copy);
    return { ...p, surfaces };
  });
  state().select({ surfaceId: copy.id, corner: null });
}

export function deleteSelected(): void {
  const { project, selection } = state();
  const i = project.surfaces.findIndex((s) => s.id === selection.surfaceId);
  if (i < 0) return;
  const next = project.surfaces[i + 1] ?? project.surfaces[i - 1];
  state().apply((p) => ({ ...p, surfaces: p.surfaces.filter((s) => s.id !== selection.surfaceId) }));
  state().select({ surfaceId: next?.id ?? null, corner: null });
}

export function moveLayer(delta: number): void {
  const id = state().selection.surfaceId;
  if (id) state().apply((p) => moveSurface(p, id, delta));
}

/** Arrow-key nudge in the active view's units (output pixels / media pixels). */
export function nudge(dx: number, dy: number): void {
  const { project, selection, activeView } = state();
  const surface = findSurface(project, selection.surfaceId);
  if (!surface) return;
  if (activeView === 'output') {
    const output =
      selection.corner === null
        ? translateQuad(surface.output, dx, dy)
        : setCorner(surface.output, selection.corner, {
            x: surface.output[selection.corner].x + dx,
            y: surface.output[selection.corner].y + dy,
          });
    state().apply((p) => updateSurface(p, surface.id, { output }));
  } else {
    const media = findMedia(project, surface.mediaId)!;
    const { width, height } = mediaSize(media);
    const input = moveInput(surface.input, selection.corner, dx / width, dy / height);
    state().apply((p) => updateSurface(p, surface.id, { input }));
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Moves one input corner (or the whole input quad) while keeping it inside the media. */
export function moveInput(q: Quad, corner: number | null, dx: number, dy: number): Quad {
  if (corner !== null) {
    return setCorner(q, corner, { x: clamp01(q[corner].x + dx), y: clamp01(q[corner].y + dy) });
  }
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const cdx = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs));
  const cdy = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys));
  return translateQuad(q, cdx, cdy);
}

/** Tab / Shift+Tab: steps through the corners of every surface, front surface first. */
export function cycleCorner(dir: 1 | -1): void {
  const { project, selection } = state();
  const order = project.surfaces.slice().reverse();
  if (order.length === 0) return;
  let si = order.findIndex((s) => s.id === selection.surfaceId);
  let corner = selection.corner;
  if (si < 0) {
    si = 0;
    corner = dir === 1 ? -1 : 4;
  } else if (corner === null) {
    corner = dir === 1 ? -1 : 4;
  }
  corner += dir;
  if (corner > 3) {
    si = (si + 1) % order.length;
    corner = 0;
  } else if (corner < 0) {
    si = (si - 1 + order.length) % order.length;
    corner = 3;
  }
  state().select({ surfaceId: order[si].id, corner });
}

export function assignMedia(surfaceId: string, mediaId: string): void {
  state().apply((p) => updateSurface(p, surfaceId, { mediaId }));
}

export function resetInput(surfaceId: string): void {
  state().apply((p) => updateSurface(p, surfaceId, { input: cloneQuad(FULL_INPUT) }));
}

/** Snaps the output quad back to an axis-aligned rectangle around its current bounds. */
export function squareOutput(surfaceId: string): void {
  const s = findSurface(state().project, surfaceId);
  if (!s) return;
  const xs = s.output.map((p) => p.x);
  const ys = s.output.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  state().apply((p) => updateSurface(p, surfaceId, { output: rectQuad(x, y, Math.max(...xs) - x, Math.max(...ys) - y) }));
}

export async function addMediaFiles(files?: PickedFile[]): Promise<void> {
  const picked = files ?? (await pickMediaFiles(true));
  let last: Media | null = null;
  for (const p of picked) {
    try {
      const media = await importMedia(pool, p);
      playback.reset(media.id);
      setMediaStatus(media.id, 'ready');
      state().apply((proj) => ({ ...proj, media: [...proj.media, media] }));
      last = media;
    } catch (err) {
      toast(errorText(err), true);
    }
  }
  if (last) {
    state().select({ mediaId: last.id });
    toast(`미디어 ${picked.length}개를 추가했습니다. 서피스에 끌어다 놓거나 “선택한 서피스에 적용”을 누르세요.`);
  }
}

export function deleteMedia(mediaId: string): void {
  playback.pause(mediaId);
  state().apply((p) => removeMedia(p, mediaId));
  state().select({ mediaId: null });
}

export function setLoop(mediaId: string, loop: boolean): void {
  pool.setLoop(mediaId, loop);
  state().apply((p) => updateMedia(p, mediaId, { loop }));
}

export function togglePlay(mediaId: string): void {
  if (!pool.video(mediaId)) return;
  if (playback.isPlaying(mediaId)) playback.pause(mediaId);
  else playback.play(mediaId);
}

export function restart(mediaId: string): void {
  if (pool.video(mediaId)) playback.seek(mediaId, 0);
}

/** Media of the current selection, for the Space shortcut. */
export function focusedMediaId(): string {
  return inputMedia(state().project).id;
}

/** Restores saved media into the pool. Non-interactive at startup, interactive from a click. */
export async function restoreAllMedia(interactive: boolean): Promise<void> {
  const { project } = state();
  const { mediaStatus } = runtimeStore.getState();
  for (const m of project.media) {
    if (m.kind === 'testcard' || mediaStatus[m.id] === 'ready' || mediaStatus[m.id] === 'loading') continue;
    setMediaStatus(m.id, 'loading');
    try {
      setMediaStatus(m.id, await restoreMedia(pool, m, interactive));
    } catch (err) {
      console.error(err);
      setMediaStatus(m.id, 'error');
    }
  }
}

export async function relink(mediaId: string): Promise<void> {
  const media = findMedia(state().project, mediaId);
  if (!media) return;
  try {
    const updated = await relinkMedia(pool, media);
    if (!updated) return;
    playback.reset(mediaId);
    setMediaStatus(mediaId, 'ready');
    state().apply((p) => updateMedia(p, mediaId, { ...updated, loop: media.loop, name: updated.name }));
    pool.setLoop(mediaId, media.loop);
  } catch (err) {
    toast(errorText(err), true);
  }
}

export function newProject(): void {
  if (!confirm('새 프로젝트를 시작할까요? 저장하지 않은 변경은 사라집니다.')) return;
  resetCurrentFile();
  runtimeStore.setState({ mediaStatus: {} });
  state().load(createProject());
}

export async function openProject(): Promise<void> {
  try {
    const project = await openProjectFile();
    if (!project) return;
    runtimeStore.setState({ mediaStatus: {} });
    state().load(project);
    await restoreAllMedia(false);
    toast('프로젝트를 열었습니다.');
  } catch (err) {
    toast(errorText(err), true);
  }
}

export async function saveProject(saveAs = false): Promise<void> {
  try {
    const name = await saveProjectFile(state().project, saveAs);
    if (name) toast(`${name}에 저장했습니다.`);
  } catch (err) {
    toast(errorText(err), true);
  }
}

export function toggleTestPattern(): void {
  state().apply((p) => ({ ...p, output: { ...p.output, testPattern: !p.output.testPattern } }));
}
