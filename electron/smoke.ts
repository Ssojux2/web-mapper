import { app, type BrowserWindow, type WebPreferences } from 'electron';
import { writeFileSync } from 'node:fs';
import { listSources, screenPermission } from './capture';
import { closeOutput, openOutput, outputStatus, outputWindow } from './output-window';

// `--smoke-test[=result.json]`: drives the real app through its main paths, writes a JSON
// report and exits 0 (all passed) or 1. Used on the packaged app locally and in CI.

type Outcome = { ok: boolean | 'skipped'; detail?: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`${what}: ${ms}ms 안에 끝나지 않음`)))]);
}

type Falsy = null | undefined | false;

async function until<T>(fn: () => Promise<T | Falsy> | T | Falsy, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`${what}: 시간 초과`);
    await sleep(200);
  }
}

const js = <T>(w: BrowserWindow, code: string): Promise<T> => w.webContents.executeJavaScript(code, true);

/** Saves what a window shows next to the report, e.g. result.editor.png. */
async function screenshot(w: BrowserWindow, outFile: string, name: string): Promise<string> {
  const file = outFile.replace(/\.json$/, '') + `.${name}.png`;
  writeFileSync(file, (await w.webContents.capturePage()).toPNG());
  return file;
}

export async function runSmokeTest(
  editor: BrowserWindow,
  outFile: string,
  opts: { pageUrl(page: string): string; origin: string; webPreferences: WebPreferences },
): Promise<number> {
  const checks: Record<string, Outcome> = {};
  const check = async (name: string, fn: () => Promise<Outcome>) => {
    try {
      checks[name] = await withTimeout(fn(), 30_000, name);
    } catch (err) {
      checks[name] = { ok: false, detail: String(err) };
    }
  };

  await check('editor', async () => {
    await until(() => js<boolean>(editor, `!!window.__mapper && !!document.querySelector('.toolbar .brand')`).catch(() => false), 20_000, 'editor');
    const origin = await js<string>(editor, 'location.origin');
    const shot = await screenshot(editor, outFile, 'editor');
    return { ok: origin === opts.origin, detail: { origin, expected: opts.origin, desktop: await js<boolean>(editor, '!!window.mapperDesktop'), shot } };
  });

  await check('webgl2', async () => {
    const info = await js<{ ok: boolean; renderer?: string }>(
      editor,
      `(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return { ok: false };
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { ok: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }; })()`,
    );
    return { ok: info.ok, detail: info.renderer };
  });

  await check('storage', async () => {
    const ok = await js<boolean>(
      editor,
      `(async () => {
        localStorage.setItem('smoke', '1');
        const db = await new Promise((res, rej) => { const r = indexedDB.open('smoke', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put('ok', 'k'); t.oncomplete = res; t.onerror = () => rej(t.error); });
        const v = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('k'); r.onsuccess = () => res(r.result); });
        db.close();
        return localStorage.getItem('smoke') === '1' && v === 'ok';
      })()`,
    );
    return { ok };
  });

  await check('project-io', async () => {
    const ok = await js<boolean>(
      editor,
      `(() => { const { editorStore, io } = window.__mapper; const p = editorStore.getState().project;
        return JSON.stringify(io.parseProject(io.serializeProject(p))) === JSON.stringify(p); })()`,
    );
    const pickers = await js<boolean>(editor, `typeof showOpenFilePicker === 'function' && typeof showSaveFilePicker === 'function'`);
    return { ok, detail: { fileSystemAccess: pickers } };
  });

  await check('output-window', async () => {
    await openOutput(opts.pageUrl('output.html'), opts.webPreferences);
    const status = await until(() => (outputStatus().fullscreen ? outputStatus() : null), 10_000, 'fullscreen');
    const connected = await until(() => js<boolean>(editor, '!!window.__mapper.runtimeStore.getState().output'), 10_000, 'editor sees output');
    return { ok: status.open && connected, detail: status };
  });

  // What the projector shows: the test pattern, then a surface with two blended layers.
  await check('output-render', async () => {
    const out = outputWindow();
    if (!out) return { ok: false, detail: 'no output window' };
    const pixel = `(() => { const o = window.__mapperOutput; const p = o.getProject(); const s = p.surfaces[0];
      const x = s ? (s.output[0].x + s.output[2].x) / 2 : p.output.width / 2, y = s ? (s.output[0].y + s.output[2].y) / 2 : p.output.height / 2;
      return { testPattern: p.output.testPattern, layers: s ? s.layers.length : 0, rgba: o.renderer.readPixel(p, (id) => o.pool.get(id), p.output.width / 2, p.output.height / 2), surface: o.renderer.readPixel(p, (id) => o.pool.get(id), x, y) }; })()`;
    await js(editor, `window.__mapper.editorStore.getState().apply((p) => ({ ...p, output: { ...p.output, testPattern: true } }))`);
    const pattern = await until(async () => {
      const r = await js<{ testPattern: boolean; rgba: number[] }>(out, pixel);
      return r.testPattern && r.rgba[0] + r.rgba[1] + r.rgba[2] > 0 ? r : null;
    }, 10_000, 'test pattern');
    await screenshot(out, outFile, 'output');
    await js(
      editor,
      `window.__mapper.editorStore.getState().apply((p) => ({ ...p, output: { ...p.output, testPattern: false },
        surfaces: p.surfaces.map((s, i) => i ? s : { ...s, masks: [], mesh: undefined, layers: [s.layers[0], { ...s.layers[0], id: 'smoke-layer', blend: 'add', opacity: 0.5 }] }) }))`,
    );
    const layered = await until(async () => {
      const r = await js<{ testPattern: boolean; layers: number; surface: number[] }>(out, pixel);
      return !r.testPattern && r.layers === 2 && r.surface[0] + r.surface[1] + r.surface[2] > 0 ? r : null;
    }, 10_000, 'layered surface');
    return { ok: true, detail: { pattern: pattern.rgba, layered: layered.surface } };
  });

  // The in-app picker opens from the Media tab (with or without the permission).
  await check('capture-picker', async () => {
    await js(editor, `(() => { const b = [...document.querySelectorAll('button')]; b.find((x) => x.textContent === 'Media').click(); })()`);
    await sleep(200);
    await js(editor, `[...document.querySelectorAll('button')].find((x) => x.textContent.includes('창/화면 캡처')).click()`);
    const state = await until(
      () => js<string | null>(editor, `(() => { const p = document.querySelector('.capture-picker'); if (!p) return null;
        return p.querySelector('.source-grid, .capture-warning') ? p.querySelectorAll('.source').length + ' sources' : null; })()`),
      15_000,
      'picker',
    );
    const shot = await screenshot(editor, outFile, 'picker');
    await js(editor, `[...document.querySelectorAll('.capture-picker button')].find((x) => x.textContent === '취소').click()`);
    const closed = await until(() => js<boolean>(editor, `!document.querySelector('.capture-picker')`), 5_000, 'picker closed');
    return { ok: closed, detail: { state, shot } };
  });

  await check('capture', async () => {
    // Without the macOS screen-recording permission there is nothing to list or capture.
    const permission = screenPermission();
    if (permission !== 'granted') return { ok: 'skipped', detail: { permission } };
    const sources = await listSources();
    const screenSource = sources.find((s) => s.kind === 'screen');
    const detail = { permission, sources: sources.length, screens: sources.filter((s) => s.kind === 'screen').length };
    if (!screenSource) return { ok: false, detail };
    // The editor captures the source as a media item; the output must capture the same
    // source on its own, and stop when the media item is deleted.
    const track = await js<{ state: string; width?: number; height?: number }>(
      editor,
      `(async () => { const { pool, editorStore } = window.__mapper; const id = 'smoke-capture';
        await window.mapperDesktop.capture.select(id, ${JSON.stringify(screenSource.id)});
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const size = await pool.setStream(id, s);
        editorStore.getState().apply((p) => ({ ...p, media: [...p.media, { id, kind: 'capture', name: 'smoke', ...size, loop: true }],
          surfaces: p.surfaces.map((x, i) => i ? x : { ...x, layers: [{ ...x.layers[0], mediaId: id }] }) }));
        const t = s.getVideoTracks()[0]; return { state: t.readyState, width: t.getSettings().width, height: t.getSettings().height }; })()`,
    );
    const out = outputWindow();
    if (!out) return { ok: false, detail: 'no output window' };
    const outputTrack = `(() => { const t = window.__mapperOutput.pool.stream('smoke-capture')?.getVideoTracks()[0]; return t ? t.readyState : 'none'; })()`;
    await until(async () => (await js<string>(out, outputTrack)) === 'live', 10_000, 'output capture');
    await js(editor, `window.__mapper.editorStore.getState().apply((p) => ({ ...p, media: p.media.filter((m) => m.id !== 'smoke-capture') }))`);
    await until(async () => (await js<string>(out, outputTrack)) === 'ended', 10_000, 'output capture stopped');
    await js(editor, `window.__mapper.pool.stream('smoke-capture')?.getTracks().forEach((t) => t.stop())`);
    return { ok: track.state === 'live', detail: { ...detail, track, output: 'live, then stopped' } };
  });

  closeOutput();
  const gpu = app.getGPUFeatureStatus();
  const ok = Object.values(checks).every((c) => c.ok !== false);
  const report = { ok, app: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, gpu, checks };
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return ok ? 0 : 1;
}
