import { app, BrowserWindow, screen, type WebPreferences } from 'electron';
import { writeFileSync } from 'node:fs';
import { listSources, lookupSource, screenPermission } from './capture';
import { closeOutput, onDisplaysChanged, openOutput, outputStatus, outputWindow, setOutputFullscreen } from './output-window';

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

/**
 * Saves what a window shows next to the report, e.g. result.editor.png. Best effort:
 * a window that has not painted yet cannot be captured (software GL on CI), so it
 * retries and never fails a check.
 */
async function screenshot(w: BrowserWindow, outFile: string, name: string): Promise<string> {
  const file = outFile.replace(/\.json$/, '') + `.${name}.png`;
  let error: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      writeFileSync(file, (await w.webContents.capturePage()).toPNG());
      return file;
    } catch (err) {
      error = err;
      await sleep(500);
    }
  }
  return `screenshot failed: ${String(error)}`;
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

  // Window ↔ fullscreen, free moving/resizing, following the display it is moved to,
  // and refitting a fullscreen output after its display changed.
  await check('output-modes', async () => {
    const out = outputWindow();
    if (!out) return { ok: false, detail: 'no output window' };
    const home = screen.getDisplayMatching(out.getBounds());
    setOutputFullscreen(false);
    await until(() => !outputStatus().fullscreen, 5_000, 'leave fullscreen');
    await sleep(500);
    const windowed = out.getBounds();
    const free = out.isMovable() && out.isResizable() && windowed.width < home.bounds.width;

    const rect = { x: home.workArea.x + 40, y: home.workArea.y + 40, width: 640, height: 360 };
    out.setBounds(rect);
    const viewport = await until(async () => {
      const v = await js<{ w: number; h: number; cw: number; ch: number }>(
        out,
        `(() => { const r = document.getElementById('out').getBoundingClientRect(); return { w: innerWidth, h: innerHeight, cw: r.width, ch: r.height }; })()`,
      );
      return Math.abs(v.w - out.getContentBounds().width) <= 1 && v.cw === v.w && v.ch === v.h ? v : null;
    }, 5_000, 'canvas follows the window size');

    // With a second display: drag the window there; the editor's display list follows.
    const other = screen.getAllDisplays().find((d) => d.id !== home.id);
    let followed: unknown = 'single display';
    if (other) {
      out.setBounds({ x: other.workArea.x + 40, y: other.workArea.y + 40, width: 640, height: 360 });
      await until(() => outputStatus().displayId === other.id, 5_000, 'moved to other display');
      followed = await until(
        () => js<number | null>(editor, `(() => { const r = window.__mapper.runtimeStore.getState(); const s = r.screens[r.screenIndex]; return s && s.displayId === ${other.id} ? s.displayId : null; })()`),
        5_000,
        'editor follows the display',
      );
    }

    setOutputFullscreen(true);
    const target = screen.getDisplayMatching(out.getBounds());
    const filled = await until(() => {
      const b = out.getBounds();
      return outputStatus().fullscreen && b.width === target.bounds.width && b.height === target.bounds.height ? b : null;
    }, 5_000, 'fullscreen fills the display it is on');

    // A stale fullscreen frame (as after a resolution change) is refitted.
    out.setBounds({ ...target.bounds, width: Math.round(target.bounds.width / 2) });
    onDisplaysChanged();
    const refitted = await until(() => {
      const b = out.getBounds();
      return outputStatus().fullscreen && b.width === target.bounds.width && b.height === target.bounds.height ? b : null;
    }, 5_000, 'refit after display change');

    // Fullscreen shows no title bar: the page gets the whole display.
    const content = out.getContentBounds();
    const frameless = content.height === refitted.height && content.width === refitted.width;

    await openOutput(opts.pageUrl('output.html'), opts.webPreferences, home.id);
    await until(() => outputStatus().displayId === home.id && outputStatus().fullscreen, 5_000, 'back on the first display');
    return { ok: free && frameless, detail: { windowed, viewport, followed, filled, refitted, content } };
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

  // Several captures play on the output at once, each as its own layer: the output has
  // to capture every one of them again on its own, and stop them all when they go.
  await check('multi-capture', async () => {
    if (screenPermission() !== 'granted') return { ok: 'skipped', detail: { permission: screenPermission() } };
    const sources = await listSources();
    const screen = sources.find((s) => s.kind === 'screen');
    if (!screen) return { ok: false, detail: { sources: sources.length } };
    // A second, different source when there is one; else the same screen twice.
    const picks = [screen, sources.find((s) => s.id !== screen.id) ?? screen, screen].map((s) => s.id);
    const ids = picks.map((_, i) => `multi-${i}`);
    const editorTracks = await js<string[]>(
      editor,
      `(async () => { const { pool, editorStore } = window.__mapper; const picks = ${JSON.stringify(picks)};
        const streams = [];
        const media = [];
        for (const [i, source] of picks.entries()) {
          await window.mapperDesktop.capture.select('multi-' + i, source);
          const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          streams.push(s);
          media.push({ id: 'multi-' + i, kind: 'capture', name: 'multi ' + i, ...(await pool.setStream('multi-' + i, s)), loop: true });
        }
        editorStore.getState().apply((p) => {
          let next = { ...p, media: [...p.media, ...media] };
          for (const m of media) {
            const base = next.surfaces[0];
            const surface = { ...base, id: 'layer-' + m.id, name: m.name, layers: [{ ...base.layers[0], id: 'l-' + m.id, mediaId: m.id }] };
            next = { ...next, surfaces: [...next.surfaces, surface] };
          }
          return next;
        });
        return streams.map((s) => s.getVideoTracks()[0].readyState); })()`,
    );
    const out = outputWindow();
    if (!out) return { ok: false, detail: 'no output window' };
    const states = `${JSON.stringify(ids)}.map((id) => window.__mapperOutput.pool.stream(id)?.getVideoTracks()[0]?.readyState ?? 'none')`;
    await until(async () => (await js<string[]>(out, states)).every((x) => x === 'live'), 15_000, 'output plays every capture');
    const distinct = await js<number>(out, `new Set(${JSON.stringify(ids)}.map((id) => window.__mapperOutput.pool.stream(id))).size`);
    await js(
      editor,
      `(() => { const { pool, editorStore } = window.__mapper; const ids = ${JSON.stringify(ids)};
        for (const id of ids) pool.stream(id)?.getTracks().forEach((t) => t.stop());
        editorStore.getState().apply((p) => ({ ...p, media: p.media.filter((m) => !ids.includes(m.id)), surfaces: p.surfaces.filter((s) => !s.id.startsWith('layer-multi-')) })); })()`,
    );
    await until(async () => (await js<string[]>(out, states)).every((x) => x !== 'live'), 10_000, 'output stops every capture');
    return { ok: editorTracks.every((x) => x === 'live') && distinct === ids.length, detail: { picks, editorTracks, outputStreams: distinct } };
  });

  // A captured window that goes fullscreen is swapped for the screen it fills (macOS
  // captures fullscreen windows with a broken frame), in the editor and the output.
  await check('fullscreen-window-capture', async () => {
    if (process.platform !== 'darwin' || screenPermission() !== 'granted') return { ok: 'skipped', detail: 'macOS with screen recording only' };
    const out = outputWindow();
    if (!out) return { ok: false, detail: 'no output window' };
    const outDisplay = screen.getDisplayMatching(out.getBounds());
    const other = screen.getAllDisplays().find((d) => d.id !== outDisplay.id);
    if (!other) return { ok: 'skipped', detail: 'needs a second display' };
    const target = new BrowserWindow({ x: other.workArea.x + 60, y: other.workArea.y + 60, width: 800, height: 450, title: 'smoke-target' });
    try {
      await target.loadURL('data:text/html,<body style="margin:0;height:100vh;background:linear-gradient(90deg,red,lime 50%25,blue)">');
      const windowSource = target.getMediaSourceId();
      await js(
        editor,
        `(async () => { const { pool, editorStore } = window.__mapper; const id = 'fs-capture';
          await window.mapperDesktop.capture.select(id, ${JSON.stringify(windowSource)});
          const size = await pool.setStream(id, await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }));
          editorStore.getState().apply((p) => ({ ...p, media: [...p.media, { id, kind: 'capture', name: 'fs', ...size, loop: true }],
            surfaces: p.surfaces.map((x, i) => i ? x : { ...x, layers: [{ ...x.layers[0], mediaId: id }] }) })); })()`,
      );
      const width = (w: BrowserWindow) => js<number>(w, `(window.__mapper ?? window.__mapperOutput).pool.stream('fs-capture')?.getVideoTracks()[0]?.getSettings().width ?? 0`);
      await until(async () => (await width(out)) > 0, 10_000, 'output captures the window');
      target.setSimpleFullScreen(true);
      const screenSource = await until(() => lookupSource('fs-capture')?.startsWith('screen:') && lookupSource('fs-capture'), 10_000, 'switch to the screen');
      const full = Math.round(other.bounds.width * other.scaleFactor);
      await until(async () => (await width(editor)) === full && (await width(out)) === full, 10_000, 'both windows capture the screen');
      target.setSimpleFullScreen(false);
      await until(() => lookupSource('fs-capture') === windowSource, 10_000, 'back to the window');
      await until(async () => (await width(editor)) === Math.round(800 * other.scaleFactor), 10_000, 'editor captures the window again');
      return { ok: true, detail: { windowSource, screenSource, screenWidth: full } };
    } finally {
      await js(editor, `(() => { const { pool, editorStore } = window.__mapper; pool.stream('fs-capture')?.getTracks().forEach((t) => t.stop());
        editorStore.getState().apply((p) => ({ ...p, media: p.media.filter((m) => m.id !== 'fs-capture') })); })()`);
      target.destroy();
    }
  });

  closeOutput();
  const gpu = app.getGPUFeatureStatus();
  const ok = Object.values(checks).every((c) => c.ok !== false);
  const report = { ok, app: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, gpu, checks };
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return ok ? 0 : 1;
}
