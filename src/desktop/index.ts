import type { MapperDesktopApi } from './api';

// The desktop app's preload script exposes `window.mapperDesktop`; the web build has none.

declare global {
  interface Window {
    mapperDesktop?: MapperDesktopApi;
  }
}

export const desktop: MapperDesktopApi | undefined = typeof window !== 'undefined' ? window.mapperDesktop : undefined;
export const isDesktop = !!desktop;
