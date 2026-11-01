import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/editor.css';
import { App } from './App';
import { editorStore, pool, runtimeStore } from './context';
import { desktop } from '../desktop';
import { parseProject, serializeProject } from '../project/io';

// Debug/test handles: the dev server, and the desktop app's --smoke-test run.
if (import.meta.env.DEV || desktop?.smoke) {
  Object.assign(window, { __mapper: { editorStore, runtimeStore, pool, io: { parseProject, serializeProject } } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
