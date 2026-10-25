import { cloneQuad, createId, createMesh, createProject, createSurface, findMedia, findSurface, FULL_INPUT, moveSurface, rectQuad, removeMedia, TESTCARD_ID, translateSurface, updateMask, updateMedia, updateSurface, type Mask, type Media, type Point, type Project, type Quad, type ReferenceImage, type Surface } from '../core/model';
import { setCorner, translateQuad } from '../core/geometry';
import { isMeshCorner, resampleMesh, surfaceGeometry } from '../core/mesh';
import { importMedia, loadRememberedFile, pickImageFile, pickMediaFiles, relinkMedia, rememberFile, restoreMedia, type PickedFile } from '../media/library';
import { captureKindLabel, pickCapture, stopStream } from '../media/capture';
import { openProjectFile, resetCurrentFile, saveProjectFile } from '../project/io';
import { editorStore, pool, runtimeStore, setMediaStatus, toast, type EditMode } from './context';
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
  const moved = translateSurface(src, 24, 24);
  const copy: Surface = {
    ...src,
    id: createId('surface'),
    name: `${src.name} 복사본`,
    input: cloneQuad(src.input),
    output: moved.output,
    masks: moved.masks.map((m) => ({ ...m, id: createId('mask') })),
    mesh: src.mesh && { ...src.mesh, offsets: src.mesh.offsets.map((o) => ({ ...o })) },
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

/**
 * Arrow-key nudge in the active view's units (output pixels / media pixels). In the
 * Output view it moves what the edit mode works on: a mesh point, a mask (point), or the
 * selected corner / whole surface.
 */
export function nudge(dx: number, dy: number): void {
  const { project, selection, activeView } = state();
  const surface = findSurface(project, selection.surfaceId);
  if (!surface) return;
  if (activeView === 'output') {
    const mode = runtimeStore.getState().editMode;
    const mask = surface.masks.find((m) => m.id === selection.maskId);
    if (mode === 'mesh' && surface.mesh && selection.point !== null && !isMeshCorner(surface.mesh, selection.point)) {
      moveMeshPoint(surface, selection.point, dx, dy);
    } else if (mode === 'mask' && mask) {
      const points = mask.points.map((p, i) =>
        selection.maskPoint === null || selection.maskPoint === i ? { x: p.x + dx, y: p.y + dy } : p,
      );
      state().apply((p) => updateMask(p, surface.id, mask.id, { points }));
    } else if (selection.corner === null) {
      state().apply((p) => updateSurface(p, surface.id, translateSurface(surface, dx, dy)));
    } else {
      const output = setCorner(surface.output, selection.corner, {
        x: surface.output[selection.corner].x + dx,
        y: surface.output[selection.corner].y + dy,
      });
      state().apply((p) => updateSurface(p, surface.id, { output }));
    }
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
  // Removing a capture ends the sharing (undo brings the entry back to be re-picked).
  if (pool.stream(mediaId)) stopStream(pool.stream(mediaId));
  else playback.pause(mediaId);
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

// Tab/screen capture

/** Keeps a capture's status and size in step with its stream. */
function watchCapture(mediaId: string, stream: MediaStream): void {
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (pool.stream(mediaId) === stream) setMediaStatus(mediaId, 'missing');
  });
  // A captured tab changes size when its window is resized.
  pool.video(mediaId)?.addEventListener('resize', (e) => {
    const v = e.target as HTMLVideoElement;
    const m = findMedia(state().project, mediaId);
    if (m && v.videoWidth && (m.width !== v.videoWidth || m.height !== v.videoHeight)) {
      state().apply((p) => updateMedia(p, mediaId, { width: v.videoWidth, height: v.videoHeight }), { record: false });
    }
  });
}

async function startCapture(mediaId: string): Promise<{ stream: MediaStream; width: number; height: number } | null> {
  const stream = await pickCapture();
  if (!stream) return null;
  try {
    const size = await pool.setStream(mediaId, stream);
    watchCapture(mediaId, stream);
    setMediaStatus(mediaId, 'ready');
    return { stream, ...size };
  } catch (err) {
    stopStream(stream);
    throw err;
  }
}

/** Adds a live tab/screen capture as media. */
export async function addCapture(): Promise<void> {
  const id = createId('capture');
  try {
    const started = await startCapture(id);
    if (!started) return;
    const label = captureKindLabel(started.stream);
    const n = state().project.media.filter((m) => m.name.startsWith(label)).length + 1;
    const name = `${label} ${n}`;
    const media: Media = { id, kind: 'capture', name, width: started.width, height: started.height, loop: true };
    state().apply((p) => ({ ...p, media: [...p.media, media] }));
    state().select({ mediaId: id });
    toast('캡처를 추가했습니다. 서피스에 끌어다 놓고, 필요하면 Input 뷰에서 영상 부분만 잘라 쓰세요.');
  } catch (err) {
    toast(errorText(err), true);
  }
}

/** Picks a new tab/screen for an existing capture entry (after a reload or when sharing stopped). */
export async function recapture(mediaId: string): Promise<void> {
  const old = pool.stream(mediaId);
  try {
    const started = await startCapture(mediaId);
    if (!started) return;
    if (old !== started.stream) stopStream(old);
    state().apply((p) => updateMedia(p, mediaId, { width: started.width, height: started.height }));
  } catch (err) {
    toast(errorText(err), true);
  }
}

export async function relink(mediaId: string): Promise<void> {
  const media = findMedia(state().project, mediaId);
  if (!media) return;
  if (media.kind === 'capture') return recapture(mediaId);
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

export function setEditMode(editMode: EditMode): void {
  if (editMode === 'reference' && !state().project.output.reference) {
    toast('먼저 Output 탭에서 참조 이미지를 불러오세요.');
    return;
  }
  runtimeStore.setState({ editMode });
}

/** Delete key: removes what the current edit mode has selected. */
export function deleteInContext(): void {
  const { selection } = state();
  const surface = selectedSurface();
  const mode = runtimeStore.getState().editMode;
  if (mode === 'mask' && surface && selection.maskId) {
    const mask = surface.masks.find((m) => m.id === selection.maskId);
    if (mask && selection.maskPoint !== null && mask.points.length > 3) {
      const points = mask.points.filter((_, i) => i !== selection.maskPoint);
      state().apply((p) => updateMask(p, surface.id, mask.id, { points }));
      state().select({ maskPoint: null });
    } else {
      removeMask(surface.id, selection.maskId);
    }
    return;
  }
  if (mode === 'mesh' && surface?.mesh && selection.point !== null) {
    // A mesh point cannot be removed; Delete puts it back on the flat grid.
    const offsets = surface.mesh.offsets.map((o, i) => (i === selection.point ? { x: 0, y: 0 } : o));
    state().apply((p) => updateSurface(p, surface.id, { mesh: { ...surface.mesh!, offsets } }));
    return;
  }
  deleteSelected();
}

// Mesh warp

export function moveMeshPoint(surface: Surface, index: number, dx: number, dy: number): void {
  const mesh = surface.mesh;
  if (!mesh || isMeshCorner(mesh, index)) return;
  const offsets = mesh.offsets.map((o, i) => (i === index ? { x: o.x + dx, y: o.y + dy } : o));
  state().apply((p) => updateSurface(p, surface.id, { mesh: { ...mesh, offsets } }));
}

export function enableMesh(surfaceId: string): void {
  state().apply((p) => updateSurface(p, surfaceId, { mesh: createMesh(4, 4) }));
}

export function removeMesh(surfaceId: string): void {
  state().apply((p) => updateSurface(p, surfaceId, { mesh: undefined }));
  state().select({ point: null });
}

export function setMeshSize(surfaceId: string, cols: number, rows: number): void {
  const mesh = findSurface(state().project, surfaceId)?.mesh;
  if (!mesh || (mesh.cols === cols && mesh.rows === rows)) return;
  state().apply((p) => updateSurface(p, surfaceId, { mesh: resampleMesh(mesh, cols, rows) }));
  state().select({ point: null });
}

export function setMeshSmooth(surfaceId: string, smooth: boolean): void {
  const mesh = findSurface(state().project, surfaceId)?.mesh;
  if (mesh) state().apply((p) => updateSurface(p, surfaceId, { mesh: { ...mesh, smooth } }));
}

export function flattenMesh(surfaceId: string): void {
  const mesh = findSurface(state().project, surfaceId)?.mesh;
  if (mesh) state().apply((p) => updateSurface(p, surfaceId, { mesh: createMesh(mesh.cols, mesh.rows, mesh.smooth) }));
}

// Masks

/** Adds a polygon mask (output pixels) to a surface and selects it. */
export function addMask(surfaceId: string, points: Point[]): void {
  const surface = findSurface(state().project, surfaceId);
  if (!surface || points.length < 3) return;
  const mask: Mask = {
    id: createId('mask'),
    name: `Mask ${surface.masks.length + 1}`,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    invert: false,
    feather: 0,
    enabled: true,
  };
  state().apply((p) => updateSurface(p, surfaceId, { masks: [...surface.masks, mask] }));
  state().select({ maskId: mask.id, maskPoint: null });
}

/** Rectangle mask slightly inside the surface's bounds, a quick starting point. */
export function addRectMask(surfaceId: string): void {
  const surface = findSurface(state().project, surfaceId);
  if (!surface) return;
  const outline = surfaceGeometry(surface).outline;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const ix = (x1 - x0) * 0.1;
  const iy = (y1 - y0) * 0.1;
  addMask(surfaceId, rectQuad(x0 + ix, y0 + iy, x1 - x0 - 2 * ix, y1 - y0 - 2 * iy));
  runtimeStore.setState({ editMode: 'mask' });
}

export function setMask(surfaceId: string, maskId: string, patch: Partial<Mask>): void {
  state().apply((p) => updateMask(p, surfaceId, maskId, patch));
}

export function removeMask(surfaceId: string, maskId: string): void {
  const surface = findSurface(state().project, surfaceId);
  if (!surface) return;
  state().apply((p) => updateSurface(p, surfaceId, { masks: surface.masks.filter((m) => m.id !== maskId) }));
  state().select({ maskId: null, maskPoint: null });
}

/** Inserts a point into a mask after index `after` and selects it. */
export function insertMaskPoint(surfaceId: string, maskId: string, after: number, point: Point): void {
  const mask = findSurface(state().project, surfaceId)?.masks.find((m) => m.id === maskId);
  if (!mask) return;
  const points = mask.points.slice();
  points.splice(after + 1, 0, { x: point.x, y: point.y });
  state().apply((p) => updateMask(p, surfaceId, maskId, { points }));
  state().select({ maskId, maskPoint: after + 1 });
}

// Reference image (editor-only photo of the real scene)

function setReferenceRuntime(key: string, url: string | null, status: Parameters<typeof setMediaStatus>[1]): void {
  const prev = runtimeStore.getState().reference;
  if (prev?.url && prev.url !== url) URL.revokeObjectURL(prev.url);
  runtimeStore.setState({ reference: { key, url, status } });
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
}

export async function loadReference(): Promise<void> {
  let picked: PickedFile | null;
  try {
    picked = await pickImageFile();
  } catch (err) {
    toast(errorText(err), true);
    return;
  }
  if (!picked) return;
  const url = URL.createObjectURL(picked.file);
  let size: { width: number; height: number };
  try {
    size = await imageSize(url);
  } catch {
    URL.revokeObjectURL(url);
    toast(`이미지를 열 수 없습니다: ${picked.file.name}`, true);
    return;
  }
  const key = createId('reference');
  await rememberFile(key, picked);
  setReferenceRuntime(key, url, 'ready');
  const { width, height } = state().project.output;
  const reference: ReferenceImage = {
    fileKey: key,
    name: picked.file.name,
    width: size.width,
    height: size.height,
    quad: rectQuad(0, 0, width, height),
    opacity: 0.5,
    visible: true,
  };
  setReference(reference);
  toast('참조 이미지를 불러왔습니다. “참조” 모드에서 네 코너를 끌어 실제 장면과 맞추세요.');
}

/** Loads the project's reference photo from storage if this window does not show it yet. */
export async function restoreReference(interactive: boolean): Promise<void> {
  const ref = state().project.output.reference;
  if (!ref) return;
  const current = runtimeStore.getState().reference;
  if (current?.key === ref.fileKey && (current.status === 'ready' || current.status === 'loading')) return;
  setReferenceRuntime(ref.fileKey, null, 'loading');
  const file = await loadRememberedFile(ref.fileKey, interactive);
  if (typeof file === 'string') setReferenceRuntime(ref.fileKey, null, file);
  else setReferenceRuntime(ref.fileKey, URL.createObjectURL(file), 'ready');
}

export function setReference(reference: ReferenceImage | undefined): void {
  state().apply((p) => ({ ...p, output: { ...p.output, reference } }));
  if (!reference && runtimeStore.getState().editMode === 'reference') runtimeStore.setState({ editMode: 'surface' });
}

export function updateReference(patch: Partial<ReferenceImage>): void {
  const ref = state().project.output.reference;
  if (ref) setReference({ ...ref, ...patch });
}

export function fitReference(): void {
  const { width, height } = state().project.output;
  updateReference({ quad: rectQuad(0, 0, width, height) });
}
