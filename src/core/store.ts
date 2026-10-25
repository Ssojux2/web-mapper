import { createStore } from 'zustand/vanilla';
import { createProject, type Project } from './model';

export type ViewKind = 'input' | 'output';

export interface Selection {
  surfaceId: string | null;
  /** Selected corner of the selected surface (0..3), or null for the whole surface. */
  corner: number | null;
  /** Media focused in the Media Bin. */
  mediaId: string | null;
  /** Selected mesh control point (index into mesh.offsets) of the selected surface. */
  point: number | null;
  /** Selected mask of the selected surface, and optionally one of its points. */
  maskId: string | null;
  maskPoint: number | null;
}

const EMPTY_SELECTION: Selection = { surfaceId: null, corner: null, mediaId: null, point: null, maskId: null, maskPoint: null };
const SURFACE_PARTS = ['corner', 'point', 'maskId', 'maskPoint'] as const;

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  /** View that last received a pointer event; decides what arrow keys move. */
  activeView: ViewKind;
  /** Project as it was when the current drag started; the drag is one undo step. */
  gestureBase: Project | null;

  /** Applies a change. `record: false` skips the undo history (used during drags). */
  apply(fn: (p: Project) => Project, opts?: { record?: boolean }): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  /** Replaces the whole project (open file / restore) and clears history. */
  load(project: Project): void;
  select(patch: Partial<Selection>): void;
  setActiveView(view: ViewKind): void;
}

export function createEditorStore(initial: Project = createProject()) {
  return createStore<EditorState>()((set, get) => ({
    project: initial,
    past: [],
    future: [],
    selection: { ...EMPTY_SELECTION, surfaceId: initial.surfaces[0]?.id ?? null },
    activeView: 'output',
    gestureBase: null,

    apply(fn, opts) {
      const { project, past, gestureBase } = get();
      const next = fn(project);
      if (next === project) return;
      const record = (opts?.record ?? true) && !gestureBase;
      set(record ? { project: next, past: [...past, project], future: [] } : { project: next });
    },

    beginGesture() {
      if (!get().gestureBase) set({ gestureBase: get().project });
    },

    endGesture() {
      const { gestureBase, project, past } = get();
      if (!gestureBase) return;
      if (gestureBase === project) set({ gestureBase: null });
      else set({ gestureBase: null, past: [...past, gestureBase], future: [] });
    },

    undo() {
      const { past, project, future } = get();
      if (past.length === 0) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], gestureBase: null });
      get().select({});
    },

    redo() {
      const { past, project, future } = get();
      if (future.length === 0) return;
      set({ project: future[0], past: [...past, project], future: future.slice(1), gestureBase: null });
      get().select({});
    },

    load(project) {
      set({
        project,
        past: [],
        future: [],
        gestureBase: null,
        selection: { ...EMPTY_SELECTION, surfaceId: project.surfaces[0]?.id ?? null },
      });
    },

    select(patch) {
      const { project, selection } = get();
      const next = { ...selection, ...patch };
      // Switching surface clears the parts that belonged to the previous one.
      if ('surfaceId' in patch && patch.surfaceId !== selection.surfaceId) {
        for (const k of SURFACE_PARTS) if (!(k in patch)) next[k] = null;
      }
      // Drop references to things that no longer exist (e.g. after undo).
      const surface = project.surfaces.find((s) => s.id === next.surfaceId);
      if (!surface) next.surfaceId = null;
      if (!surface) for (const k of SURFACE_PARTS) next[k] = null;
      if (next.point !== null && !(surface?.mesh && next.point < surface.mesh.offsets.length)) next.point = null;
      const mask = surface?.masks.find((m) => m.id === next.maskId);
      if (!mask) next.maskId = null;
      if (!mask || (next.maskPoint !== null && next.maskPoint >= mask.points.length)) next.maskPoint = null;
      if (next.mediaId && !project.media.some((m) => m.id === next.mediaId)) next.mediaId = null;
      set({ selection: next });
    },

    setActiveView(view) {
      if (get().activeView !== view) set({ activeView: view });
    },
  }));
}

export type EditorStore = ReturnType<typeof createEditorStore>;
