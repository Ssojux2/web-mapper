// Minimal IndexedDB key-value store for media file handles / blobs.

const DB_NAME = 'web-mapper';
const STORE = 'media-files';

export type StoredFile = { handle: FileSystemFileHandle } | { file: File };

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function putFile(key: string, value: StoredFile): Promise<IDBValidKey> {
  return run('readwrite', (s) => s.put(value, key));
}

export function getFile(key: string): Promise<StoredFile | undefined> {
  return run('readonly', (s) => s.get(key) as IDBRequest<StoredFile | undefined>);
}

export function deleteFile(key: string): Promise<undefined> {
  return run('readwrite', (s) => s.delete(key));
}
