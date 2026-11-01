// Contract between the Electron preload script and the renderer. Types only, so both
// the app (electron/) and the web build can import it without pulling in Electron.

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  /** In DIPs, as Electron's screen API reports them. */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** PNG data URL. */
  thumbnail: string;
}

/** macOS screen-recording permission; always 'granted' elsewhere. */
export type ScreenPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface DesktopOutputStatus {
  open: boolean;
  displayId?: number;
  fullscreen: boolean;
  /** Physical pixels of the display the output window is on. */
  width: number;
  height: number;
}

export interface MapperDesktopApi {
  platform: string;
  /** Started with --smoke-test: the renderer exposes its test hooks. */
  smoke: boolean;
  displays(): Promise<DisplayInfo[]>;
  output: {
    /** Opens (or moves) the output window, fullscreen on the display. */
    open(displayId?: number): Promise<void>;
    close(): Promise<void>;
    toggleFullscreen(): Promise<void>;
    status(): Promise<DesktopOutputStatus>;
    onStatus(cb: (status: DesktopOutputStatus) => void): () => void;
  };
  capture: {
    sources(): Promise<CaptureSource[]>;
    /**
     * Remembers `sourceId` for the media and arms the next getDisplayMedia() call of
     * this window to capture it.
     */
    select(mediaId: string, sourceId: string): Promise<void>;
    /** The source picked for a media item, so the output window can capture it too. */
    lookup(mediaId: string): Promise<string | null>;
    permission(): Promise<ScreenPermission>;
    openSettings(): Promise<void>;
  };
}
