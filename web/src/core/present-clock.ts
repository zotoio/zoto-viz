/** Present-to-present interval from the last rAF mark (ms). */
let lastPresentTs = 0;
let presentIntervalMs = 0;
const presentSamples: number[] = [];
const PRESENT_KEEP = 180;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

/** Record a vsync timestamp from {@link markFrame}. */
export function markPresent(ts: number): void {
  if (lastPresentTs > 0) {
    presentIntervalMs = ts - lastPresentTs;
    presentSamples.push(presentIntervalMs);
    if (presentSamples.length > PRESENT_KEEP) presentSamples.shift();
  }
  lastPresentTs = ts;
}

export function resetPresentClock(): void {
  lastPresentTs = 0;
  presentIntervalMs = 0;
  presentSamples.length = 0;
}

/** Last measured present-to-present interval (ms), or 0 before the second frame. */
export function lastPresentIntervalMs(): number {
  return presentIntervalMs;
}

/** Present-to-present interval for continuous TypeSafe Sense (rAF clock, not monitor state.ts). */
export function presentInterval(): number {
  return presentIntervalMs;
}

export function presentFrameStats(): { last: number; p95: number } {
  if (!presentSamples.length) return { last: presentIntervalMs, p95: presentIntervalMs };
  const sorted = [...presentSamples].sort((a, b) => a - b);
  return { last: presentIntervalMs, p95: percentile(sorted, 0.95) };
}
