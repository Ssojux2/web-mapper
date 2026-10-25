import { createId, type Media, type MediaKind } from '../core/model';
import { getFile, putFile } from './idb';
import type { MediaPool } from './pool';

// Controller-side media management: picking files, remembering them across reloads
// (file handle where the File System Access API exists, a stored copy otherwise),
// and reconnecting them on startup.

export interface PickedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

const IMAGE_TYPES: FilePickerAcceptType[] = [
  { description: '이미지', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] } },
];

const MEDIA_TYPES: FilePickerAcceptType[] = [
  {
    description: '영상·이미지',
    accept: {
      'video/*': ['.mp4', '.m4v', '.mov', '.webm'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    },
  },
];

export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(mp4|m4v|mov|webm)$/i.test(file.name)) return 'video';
  if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) return 'image';
  return null;
}

async function pick(types: FilePickerAcceptType[], accept: string, multiple: boolean, id: string): Promise<PickedFile[]> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ multiple, types, id });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return [];
      throw err;
    }
  }
  return pickWithInput(accept, multiple).then((files) => files.map((file) => ({ file })));
}

/** Opens the system file picker. Resolves to [] if the user cancels. */
export function pickMediaFiles(multiple = true): Promise<PickedFile[]> {
  return pick(MEDIA_TYPES, 'video/*,image/*', multiple, 'mapper-media');
}

export async function pickImageFile(): Promise<PickedFile | null> {
  const [picked] = await pick(IMAGE_TYPES, 'image/*', false, 'mapper-reference');
  return picked ?? null;
}

export function pickWithInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Loads a picked file into the pool and persists it. Returns the new Media entry. */
export async function importMedia(pool: MediaPool, picked: PickedFile, id = createId('media')): Promise<Media> {
  const kind = kindOf(picked.file);
  if (!kind) throw new Error(`지원하지 않는 파일입니다: ${picked.file.name}`);
  const size = await pool.setFile(id, picked.file, kind);
  const fileKey = id;
  await rememberFile(fileKey, picked);
  return { id, kind, name: picked.file.name, width: size.width, height: size.height, loop: true, fileKey };
}

/** Persists a picked file under `key`: its handle where possible, else a stored copy. */
export async function rememberFile(key: string, picked: PickedFile): Promise<void> {
  try {
    await putFile(key, picked.handle ? { handle: picked.handle } : { file: picked.file });
  } catch (err) {
    // Quota or a browser that cannot store handles: the file still works this session.
    console.warn('파일을 저장하지 못했습니다', err);
  }
}

export type RestoreResult = 'ready' | 'needs-permission' | 'missing';

/**
 * Reads back a remembered file. With `interactive` (inside a click handler) it may show
 * the browser's permission prompt for a stored file handle.
 */
export async function loadRememberedFile(key: string, interactive: boolean): Promise<File | Exclude<RestoreResult, 'ready'>> {
  const stored = await getFile(key).catch(() => undefined);
  if (!stored) return 'missing';
  if (!('handle' in stored)) return stored.file;
  const handle = stored.handle;
  let state = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (state !== 'granted' && interactive && handle.requestPermission) {
    state = await handle.requestPermission({ mode: 'read' });
  }
  if (state !== 'granted') return 'needs-permission';
  try {
    return await handle.getFile();
  } catch {
    return 'missing';
  }
}

/** Restores a saved media item into the pool (see loadRememberedFile for `interactive`). */
export async function restoreMedia(pool: MediaPool, media: Media, interactive: boolean): Promise<RestoreResult> {
  if (!media.fileKey || media.kind === 'testcard') return 'missing';
  const file = await loadRememberedFile(media.fileKey, interactive);
  if (typeof file === 'string') return file;
  await pool.setFile(media.id, file, media.kind, media.loop);
  return 'ready';
}

/** Lets the user pick a replacement file for an existing media id (relink). */
export async function relinkMedia(pool: MediaPool, media: Media): Promise<Media | null> {
  const [picked] = await pickMediaFiles(false);
  if (!picked) return null;
  return importMedia(pool, picked, media.id);
}
