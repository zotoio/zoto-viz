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

/** Present-to-present interval for continuous TypeSafe Sense (rAF clock, not monitor state.ts). */
export function presentInterval(): number {
  return presentIntervalMs;
}
