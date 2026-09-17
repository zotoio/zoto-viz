import { VIZ_FRAME_BUDGET_MS } from "../plugins/viz-host";

/** Present-to-present interval from the last rAF mark (ms). */
let lastPresentTs = 0;
let presentIntervalMs = 0;

/** Record a vsync timestamp from {@link markFrame}. */
export function markPresent(ts: number): void {
  if (lastPresentTs > 0) presentIntervalMs = ts - lastPresentTs;
  lastPresentTs = ts;
}

export function resetPresentClock(): void {
  lastPresentTs = 0;
  presentIntervalMs = 0;
}

/** Last measured present-to-present interval (ms), or 0 before the second frame. */
export function lastPresentIntervalMs(): number {
  return presentIntervalMs;
}

/** Timing for continuous TypeSafe Sense — present-clock ms, not monitor state.ts. */
export function presentTiming(): { presentIntervalMs: number; headroomMs: number } {
  const intervalMs = presentIntervalMs;
  const headroomMs = VIZ_FRAME_BUDGET_MS - intervalMs;
  return { presentIntervalMs: intervalMs, headroomMs };
}
