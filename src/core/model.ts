// Project data model. Everything here is plain JSON so it can be saved,
// broadcast to the output window and kept in the undo history as-is.

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type MediaKind = 'testcard' | 'video' | 'image';

export interface Media {
  id: string;
  kind: MediaKind;
  name: string;
  /** Natural size in pixels; filled in once the element has loaded. */
  width: number;
  height: number;
  loop: boolean;
  /** Key of the file handle / blob stored in IndexedDB (not for the test card). */
  fileKey?: string;
}

export interface Surface {
  id: string;
  name: string;
  type: 'quad';
  mediaId: string;
  visible: boolean;
  opacity: number;
  /** Region of the media to show, in normalized media coordinates (0..1, y down). */
  input: Quad;
  /** Where the surface lands on the output canvas, in output pixels. */
  output: Quad;
}

export interface OutputSettings {
  width: number;
  height: number;
  testPattern: boolean;
  /** Label of the screen the output window was last opened on. */
  screenLabel?: string;
}

export interface Project {
  version: 1;
  output: OutputSettings;
  media: Media[];
  /** Layer order: index 0 is drawn first (back), last is drawn on top. */
  surfaces: Surface[];
}

export const PROJECT_VERSION = 1;
export const TESTCARD_ID = 'testcard';

export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function rectQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export const FULL_INPUT: Quad = rectQuad(0, 0, 1, 1);

export function testcardMedia(): Media {
  return { id: TESTCARD_ID, kind: 'testcard', name: 'Test Card', width: 1920, height: 1080, loop: true };
}

/** A new quad centered on the output, sized to 40% of its height with the media's aspect. */
export function createSurface(project: Project, media: Media, name?: string): Surface {
  const { width: ow, height: oh } = project.output;
  const aspect = media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  const h = oh * 0.4;
  const w = Math.min(h * aspect, ow * 0.8);
  return {
    id: createId('surface'),
    name: name ?? `Quad ${project.surfaces.length + 1}`,
    type: 'quad',
    mediaId: media.id,
    visible: true,
    opacity: 1,
    input: cloneQuad(FULL_INPUT),
    output: rectQuad((ow - w) / 2, (oh - h) / 2, w, h),
  };
}

export function createProject(): Project {
  const project: Project = {
    version: PROJECT_VERSION,
    output: { width: 1920, height: 1080, testPattern: false },
    media: [testcardMedia()],
    surfaces: [],
  };
  project.surfaces.push(createSurface(project, project.media[0]));
  return project;
}

export function cloneQuad(q: Quad): Quad {
  return q.map((p) => ({ x: p.x, y: p.y })) as Quad;
}

export function findMedia(project: Project, id: string): Media | undefined {
  return project.media.find((m) => m.id === id);
}

export function findSurface(project: Project, id: string | null): Surface | undefined {
  return id ? project.surfaces.find((s) => s.id === id) : undefined;
}

export function updateSurface(project: Project, id: string, patch: Partial<Surface>): Project {
  return { ...project, surfaces: project.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function updateMedia(project: Project, id: string, patch: Partial<Media>): Project {
  return { ...project, media: project.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
}

export function mediaUsage(project: Project, mediaId: string): number {
  return project.surfaces.filter((s) => s.mediaId === mediaId).length;
}

/** Removes a media item; surfaces that used it fall back to the test card. */
export function removeMedia(project: Project, mediaId: string): Project {
  if (mediaId === TESTCARD_ID) return project;
  return {
    ...project,
    media: project.media.filter((m) => m.id !== mediaId),
    surfaces: project.surfaces.map((s) => (s.mediaId === mediaId ? { ...s, mediaId: TESTCARD_ID } : s)),
  };
}

/** Moves a surface one step towards the front (+1) or back (-1) of the layer stack. */
export function moveSurface(project: Project, id: string, delta: number): Project {
  const i = project.surfaces.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= project.surfaces.length) return project;
  const surfaces = project.surfaces.slice();
  [surfaces[i], surfaces[j]] = [surfaces[j], surfaces[i]];
  return { ...project, surfaces };
}

function isPoint(v: unknown): v is Point {
  return typeof v === 'object' && v !== null && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);
}

function isQuad(v: unknown): v is Quad {
  return Array.isArray(v) && v.length === 4 && v.every(isPoint);
}

/** Validates parsed JSON and fills in defaults. Throws with a readable message on bad input. */
export function normalizeProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('프로젝트 파일 형식이 아닙니다.');
  const r = raw as Partial<Project>;
  if (r.version !== PROJECT_VERSION) throw new Error(`지원하지 않는 프로젝트 버전입니다: ${String(r.version)}`);
  const output: OutputSettings = {
    width: Number(r.output?.width) || 1920,
    height: Number(r.output?.height) || 1080,
    testPattern: Boolean(r.output?.testPattern),
    screenLabel: r.output?.screenLabel,
  };
  const media: Media[] = (Array.isArray(r.media) ? r.media : [])
    .filter((m) => m && typeof m.id === 'string' && m.id !== TESTCARD_ID)
    .map((m) => ({
      id: m.id,
      kind: m.kind === 'image' ? 'image' : 'video',
      name: String(m.name ?? m.id),
      width: Number(m.width) || 0,
      height: Number(m.height) || 0,
      loop: m.loop !== false,
      fileKey: typeof m.fileKey === 'string' ? m.fileKey : undefined,
    }));
  media.unshift(testcardMedia());
  const mediaIds = new Set(media.map((m) => m.id));
  const surfaces: Surface[] = (Array.isArray(r.surfaces) ? r.surfaces : [])
    .filter((s) => s && typeof s.id === 'string' && isQuad(s.input) && isQuad(s.output))
    .map((s, i) => ({
      id: s.id,
      name: String(s.name ?? `Quad ${i + 1}`),
      type: 'quad',
      mediaId: mediaIds.has(s.mediaId) ? s.mediaId : TESTCARD_ID,
      visible: s.visible !== false,
      opacity: Math.min(1, Math.max(0, Number.isFinite(s.opacity) ? s.opacity : 1)),
      input: cloneQuad(s.input),
      output: cloneQuad(s.output),
    }));
  return { version: PROJECT_VERSION, output, media, surfaces };
}
