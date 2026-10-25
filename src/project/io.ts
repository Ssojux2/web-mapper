import { normalizeProject, type Project } from '../core/model';
import { pickWithInput } from '../media/library';

const AUTOSAVE_KEY = 'web-mapper:autosave';
const FILE_TYPES: FilePickerAcceptType[] = [
  { description: 'Web Mapper 프로젝트', accept: { 'application/json': ['.mapper.json', '.json'] } },
];

export function serializeProject(project: Project): string {
  // The test card is rebuilt on load, so it is not written to the file.
  const media = project.media.filter((m) => m.kind !== 'testcard');
  return JSON.stringify({ ...project, media }, null, 2);
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('프로젝트 파일을 읽을 수 없습니다(JSON 오류).');
  }
  return normalizeProject(raw);
}

export function saveAutosave(project: Project): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
  } catch {
    // Storage full or blocked (private window): autosave is best effort.
  }
}

export function loadAutosave(): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
  }
}

/** Handle of the file the project was last saved to / opened from, for plain Cmd+S. */
let currentHandle: FileSystemFileHandle | null = null;
let currentName = 'untitled.mapper.json';

export function currentFileName(): string {
  return currentName;
}

export function resetCurrentFile(): void {
  currentHandle = null;
  currentName = 'untitled.mapper.json';
}

/** Saves to the current file, asking for a location the first time (or with `saveAs`). */
export async function saveProjectFile(project: Project, saveAs = false): Promise<string | null> {
  const text = serializeProject(project);
  if (window.showSaveFilePicker) {
    try {
      if (!currentHandle || saveAs) {
        currentHandle = await window.showSaveFilePicker({ suggestedName: currentName, types: FILE_TYPES, id: 'mapper-project' });
      }
      const writable = await currentHandle.createWritable();
      await writable.write(text);
      await writable.close();
      currentName = currentHandle.name;
      return currentName;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = currentName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return currentName;
}

export async function openProjectFile(): Promise<Project | null> {
  let file: File | undefined;
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, id: 'mapper-project' });
      file = await handle.getFile();
      currentHandle = handle;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    }
  } else {
    [file] = await pickWithInput('.json,application/json', false);
    currentHandle = null;
  }
  if (!file) return null;
  const project = parseProject(await file.text());
  currentName = file.name;
  return project;
}
