// Builds and runs the desktop app's main process and preload script.
//   node scripts/electron.mjs build   one-off build into dist-electron/
//   node scripts/electron.mjs dev     Vite dev server + watch builds + Electron
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node24', external: ['electron'], sourcemap: true, logLevel: 'info' };
const targets = [
  // ESM main (package.json is "type": "module"); the sandboxed preload must be CommonJS.
  { ...common, entryPoints: [path.join(root, 'electron/main.ts')], outfile: path.join(root, 'dist-electron/main.js'), format: 'esm' },
  { ...common, entryPoints: [path.join(root, 'electron/preload.ts')], outfile: path.join(root, 'dist-electron/preload.cjs'), format: 'cjs' },
];

const mode = process.argv[2];
if (mode === 'build') {
  await Promise.all(targets.map((t) => esbuild.build(t)));
} else if (mode === 'dev') {
  const { createServer } = await import('vite');
  const server = await createServer({ root, server: { port: 5173, strictPort: true } });
  await server.listen();
  const contexts = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.watch()));
  const electron = (await import('electron')).default;
  const child = spawn(electron, ['.', ...process.argv.slice(3)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173/' },
  });
  child.on('exit', async (code) => {
    await Promise.all(contexts.map((c) => c.dispose()));
    await server.close();
    process.exit(code ?? 0);
  });
} else {
  console.error('usage: node scripts/electron.mjs build|dev');
  process.exit(1);
}
