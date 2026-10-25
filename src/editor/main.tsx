import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/editor.css';
import { App } from './App';
import { editorStore, pool, runtimeStore } from './context';

if (import.meta.env.DEV) {
  Object.assign(window, { __mapper: { editorStore, runtimeStore, pool } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
