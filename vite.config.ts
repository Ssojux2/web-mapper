import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = import.meta.dirname;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [relative(join(root, 'public'), path).split('\\').join('/')];
  });
}

/**
 * Emits sw.js, which precaches every built file so the installed app opens offline
 * (e.g. at a venue without internet). The cache name is derived from the file list, so
 * each deploy replaces the previous cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'web-mapper-service-worker',
    apply: 'build',
    // After Vite's HTML plugin, so the pages are in the bundle too.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = [...Object.keys(bundle), ...listFiles(join(root, 'public'))].filter((f) => !f.endsWith('.map')).sort();
      const precache = ['./', ...files];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, precache) });
    },
  };
}

function swSource(version: string, precache: string[]): string {
  return `// Generated at build time by vite.config.ts.
const CACHE = 'web-mapper-${version}';
const PRECACHE = ${JSON.stringify(precache)};
const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(scoped))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('web-mapper-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Pages: network first so a new deploy shows up, cache when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match(scoped('./')))),
    );
    return;
  }
  // Hashed build assets and icons: cache first.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`;
}

export default defineConfig({
  // Relative base: works at a domain root and under GitHub Pages' /web-mapper/ path.
  base: './',
  plugins: [react(), serviceWorker()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        output: resolve(root, 'output.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
