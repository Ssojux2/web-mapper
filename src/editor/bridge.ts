import type { Project } from '../core/model';
import { SyncChannel } from '../core/sync';
import { saveAutosave } from '../project/io';
import { editorStore, pool, runtimeStore } from './context';
import { followLocal, onTransportChange, snapshot } from './playback';

// Keeps the output window in step with the controller: project snapshots on every
// change, media files when they appear, and the playback clock (see playback.ts).

export function startBridge(): () => void {
  const sync = new SyncChannel();
  const sentFiles = new Map<string, File>();

  const postProject = (project: Project) => sync.post({ type: 'project', project });

  const postFiles = (all: boolean) => {
    for (const [mediaId, { file, kind }] of pool.entries()) {
      if (!all && sentFiles.get(mediaId) === file) continue;
      sentFiles.set(mediaId, file);
      sync.post({ type: 'media-file', mediaId, kind, file });
    }
  };

  const postTransport = () => {
    const sentAt = Date.now();
    const states = snapshot(sentAt);
    if (states.length) sync.post({ type: 'transport', states, sentAt });
  };

  let autosaveTimer = 0;
  let lastProject = editorStore.getState().project;
  const unsubStore = editorStore.subscribe((s) => {
    if (s.project === lastProject) return;
    lastProject = s.project;
    postProject(s.project);
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => saveAutosave(editorStore.getState().project), 400);
  });

  const unsubPool = pool.subscribe(() => {
    postFiles(false);
    followLocal();
    postTransport();
  });
  const unsubTransport = onTransportChange(postTransport);

  const unsubSync = sync.on((msg) => {
    switch (msg.type) {
      case 'hello':
        postProject(editorStore.getState().project);
        postFiles(true);
        postTransport();
        runtimeStore.setState({ output: runtimeStore.getState().output ?? { fullscreen: false, width: 0, height: 0 } });
        break;
      case 'output-status':
        runtimeStore.setState({ output: { fullscreen: msg.fullscreen, width: msg.width, height: msg.height } });
        break;
      case 'output-closed':
        runtimeStore.setState({ output: null });
        break;
    }
  });

  // An output window may already be open (e.g. the editor was reloaded): announce ourselves.
  sync.post({ type: 'controller-hello' });
  postProject(editorStore.getState().project);
  postFiles(true);

  const clock = window.setInterval(() => {
    followLocal();
    postTransport();
  }, 500);
  const flush = () => saveAutosave(editorStore.getState().project);
  window.addEventListener('beforeunload', flush);

  return () => {
    unsubStore();
    unsubPool();
    unsubTransport();
    unsubSync();
    clearInterval(clock);
    window.removeEventListener('beforeunload', flush);
    sync.close();
  };
}
