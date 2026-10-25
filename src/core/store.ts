import { createStore } from 'zustand/vanilla';
import { createProject, type Project } from './model';

export type ViewKind = 'input' | 'output';

export interface Selection {
  surfaceId: string | null;
  /** Selected corner of the selected surface (0..3), or null for the whole surface. */
  corner: number | null;
  /** Media focused in the Media Bin. */
  mediaId: string | null;
}

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
    selection: { surfaceId: initial.surfaces[0]?.id ?? null, corner: null, mediaId: null },
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
        selection: { surfaceId: project.surfaces[0]?.id ?? null, corner: null, mediaId: null },
      });
    },

    select(patch) {
      const { project, selection } = get();
      const next = { ...selection, ...patch };
      // Drop references to things that no longer exist (e.g. after undo).
      if (next.surfaceId && !project.surfaces.some((s) => s.id === next.surfaceId)) {
        next.surfaceId = null;
      }
      if (!next.surfaceId) next.corner = null;
      if (next.mediaId && !project.media.some((m) => m.id === next.mediaId)) next.mediaId = null;
      set({ selection: next });
    },

    setActiveView(view) {
      if (get().activeView !== view) set({ activeView: view });
    },
  }));
}

export type EditorStore = ReturnType<typeof createEditorStore>;
