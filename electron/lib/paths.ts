import path from 'node:path';

/**
 * Maps an app:// URL path onto a file inside `root`, or null when it would escape it.
 * "/" serves the editor page.
 */
export function resolveAppPath(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel === '' || rel === '/') rel = '/index.html';
  const file = path.resolve(root, '.' + rel);
  const base = path.resolve(root);
  return file.startsWith(base + path.sep) ? file : null;
}
