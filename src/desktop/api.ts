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

export interface CaptureChange {
  mediaId: string;
  sourceId: string;
  /** The picked window fills a screen, which is captured instead. */
  fullscreen: boolean;
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
    /** Fullscreen on the display the window is on; without an argument it toggles. */
    setFullscreen(on?: boolean): Promise<void>;
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
    /** Arms the media's current source for this window's next getDisplayMedia() call. */
    arm(mediaId: string): Promise<boolean>;
    /** The source a media item captures now, so the output window can capture it too. */
    lookup(mediaId: string): Promise<string | null>;
    /**
     * The source of a media item changed without a new pick: a picked window went
     * fullscreen (its screen is captured instead) or came back.
     */
    onChanged(cb: (change: CaptureChange) => void): () => void;
    permission(): Promise<ScreenPermission>;
    openSettings(): Promise<void>;
  };
}
