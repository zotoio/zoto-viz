/** Browser smoke tests (Backrooms pack). Armed only when `localStorage` flag is set before load. */

export const SMOKE_BACKROOMS_KEY = "zoto-viz.smoke.backrooms";
export const SMOKE_PRESENT_TARGET = 30;
/** Pinned golden LAN snapshot `ts` for idle demo merges. */
export const SMOKE_GOLDEN_TS = 120;
/** Pinned sky shader clock (seconds) — stable corridor framing on the pack. */
export const SMOKE_SKY_TIME_S = 48.5;
/** Pinned OSD wall clock passed to `backroomsSlots`. */
export const SMOKE_WALL_CLOCK_ISO = "2026-09-26T19:24:15.000Z";

export function smokeBackroomsHarnessArmed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SMOKE_BACKROOMS_KEY) === "1";
}

export function smokeGoldenStateTs(): number {
  return SMOKE_GOLDEN_TS;
}

export function smokeBackroomsSkyTime(): number | null {
  return smokeBackroomsHarnessArmed() ? SMOKE_SKY_TIME_S : null;
}

export function smokeBackroomsWallClock(): Date | null {
  if (!smokeBackroomsHarnessArmed()) return null;
  return new Date(SMOKE_WALL_CLOCK_ISO);
}

/** One host present after {@link markFrame} dedupes a vsync (scene / mosaic / feed loops). */
export function onSmokePresentedFrame(): void {
  if (!smokeBackroomsHarnessArmed()) return;
  const w = window as unknown as { __zotoSmokePresentedFrames?: number };
  w.__zotoSmokePresentedFrames = (w.__zotoSmokePresentedFrames ?? 0) + 1;
}

export function readSmokePresentedFrames(): number {
  if (typeof window === "undefined") return 0;
  return (window as unknown as { __zotoSmokePresentedFrames?: number }).__zotoSmokePresentedFrames ?? 0;
}
