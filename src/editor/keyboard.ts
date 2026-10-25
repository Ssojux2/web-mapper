import { addQuad, cycleCorner, deleteSelected, duplicateSelected, focusedMediaId, moveLayer, nudge, openProject, saveProject, toggleTestPattern, togglePlay } from './actions';
import { editorStore } from './context';
import { FIT_EVENT } from './Viewport';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && !['checkbox', 'range', 'button'].includes((target as HTMLInputElement).type);
}

/** Editor shortcuts (MadMapper-like). Returns a cleanup function. */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const store = editorStore.getState();
    const key = e.key.toLowerCase();

    // These work even while a text field has focus.
    if (mod && key === 's') {
      e.preventDefault();
      void saveProject(e.shiftKey);
      return;
    }
    if (mod && key === 'o') {
      e.preventDefault();
      void openProject();
      return;
    }
    if (isTyping(e.target)) return;

    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (mod && key === 'd') {
      e.preventDefault();
      duplicateSelected();
    } else if (mod && key === '0') {
      e.preventDefault();
      window.dispatchEvent(new Event(FIT_EVENT));
    } else if (mod && e.key === ']') {
      e.preventDefault();
      moveLayer(1);
    } else if (mod && e.key === '[') {
      e.preventDefault();
      moveLayer(-1);
    } else if (e.key.startsWith('Arrow') && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) nudge(d[0], d[1]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      cycleCorner(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      if (store.selection.corner !== null) store.select({ corner: null });
      else store.select({ surfaceId: null });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === ' ' && !mod) {
      e.preventDefault();
      togglePlay(focusedMediaId());
    } else if (key === 'q' && !mod) {
      addQuad();
    } else if (key === 't' && !mod) {
      toggleTestPattern();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
