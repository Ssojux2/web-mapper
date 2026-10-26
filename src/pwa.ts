// Installable app (PWA) support: offline service worker and the "install app" prompt.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: InstallPromptEvent | null = null;

/** Registers the offline service worker in production builds. */
export function registerServiceWorker(onUpdate?: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('service worker', err));
  // A new deploy took over this page: the next reload uses it.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) onUpdate?.();
  });
}

/** Calls `onChange(true)` when the browser offers installing the app, `false` once installed. */
export function watchInstallPrompt(onChange: (installable: boolean) => void): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    onChange(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onChange(false);
  });
}

/** Shows the browser's install dialog. Must run inside a click handler. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  return (await prompt.userChoice).outcome === 'accepted';
}
