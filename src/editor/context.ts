import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createProject } from '../core/model';
import { createEditorStore, type EditorState } from '../core/store';
import { MediaPool } from '../media/pool';
import type { ScreenOption } from '../output/screens';
import { loadAutosave } from '../project/io';

// Controller-window singletons: the undoable project store, the runtime-only store
// (things that are not part of the project file), and this window's media elements.

export const pool = new MediaPool();
export const editorStore = createEditorStore(loadAutosave() ?? createProject());

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector);
}

export type MediaStatus = 'ready' | 'loading' | 'needs-permission' | 'missing' | 'error';

export interface OutputStatus {
  fullscreen: boolean;
  width: number;
  height: number;
}

export interface RuntimeState {
  mediaStatus: Record<string, MediaStatus>;
  /** null while no output window is connected. */
  output: OutputStatus | null;
  screens: ScreenOption[];
  screenIndex: number;
  leftTab: 'media' | 'surfaces' | 'output';
  toast: { text: string; error: boolean; id: number } | null;
}

export const runtimeStore = createStore<RuntimeState>()(() => ({
  mediaStatus: {},
  output: null,
  screens: [],
  screenIndex: -1,
  leftTab: 'surfaces',
  toast: null,
}));

export function useRuntime<T>(selector: (s: RuntimeState) => T): T {
  return useStore(runtimeStore, selector);
}

export function setMediaStatus(id: string, status: MediaStatus): void {
  runtimeStore.setState((s) => ({ mediaStatus: { ...s.mediaStatus, [id]: status } }));
}

let toastTimer = 0;
export function toast(text: string, error = false): void {
  runtimeStore.setState({ toast: { text, error, id: Date.now() } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => runtimeStore.setState({ toast: null }), error ? 6000 : 2500);
}
