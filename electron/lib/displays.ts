export interface DisplayLike {
  id: number;
}

/** The display to project on: the requested one, else the first external display, else the primary. */
export function pickDisplay<T extends DisplayLike>(displays: T[], primary: T, requested?: number): T {
  return displays.find((d) => d.id === requested) ?? displays.find((d) => d.id !== primary.id) ?? primary;
}
