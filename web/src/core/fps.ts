/**
 * Display framerate of the live UI. Several rAF loops (graph, mosaic tiles, arcade, feed)
 * share one vsync timestamp; marking the same timestamp twice does not count as two frames,
 * so a 2×2 mosaic still reads as ~60 fps when the main thread is keeping up.
 */

const SHOW_MS = 1000;
/** Keep a 1-minute trail so auto-tune can average a recovery window. */
const KEEP_MS = 60_000;
const stamps: number[] = [];
let lastTs = -1;
let shown = "";
let el: HTMLElement | null = null;
const presentListeners = new Set<(ts: number) => void>();

export function bindFps(target: HTMLElement): void {
  el = target;
}

/** Drop recorded timestamps (tests). */
export function resetFps(): void {
  stamps.length = 0;
  lastTs = -1;
  shown = "";
  presentListeners.clear();
}

/** Subscribe to present-to-present vsync marks. Returns unsubscribe. */
export function addPresentListener(fn: (ts: number) => void): () => void {
  presentListeners.add(fn);
  return () => {
    presentListeners.delete(fn);
  };
}

/**
 * @deprecated Prefer {@link addPresentListener}. Replaces all listeners with one slot.
 */
export function bindPresentListener(fn: ((ts: number) => void) | null): void {
  presentListeners.clear();
  if (fn) presentListeners.add(fn);
}

/**
 * Frames per second over the last `windowMs` of marked vsyncs, or null if the trail is too short.
 * `since` ignores stamps before a lean / view-change so the next minute is a fresh average.
 */
export function windowFps(now: number, windowMs = SHOW_MS, since = Number.NEGATIVE_INFINITY): number | null {
  if (stamps.length < 2) return null;
  const cutoff = Math.max(now - windowMs, since);
  let first = -1, n = 0;
  for (const t of stamps) {
    if (t < cutoff) continue;
    if (first < 0) first = t;
    n++;
  }
  if (n < 2 || first < 0) return null;
  const last = stamps[stamps.length - 1]!;
  const span = last - first;
  if (span < Math.min(80, windowMs * 0.5)) return null;
  if (windowMs >= KEEP_MS * 0.5 && span < windowMs * 0.85) return null;
  return ((n - 1) * 1000) / span;
}

/** Call from every animation callback with that callback's rAF timestamp. */
export function markFrame(ts: number): void {
  if (ts === lastTs) return;
  lastTs = ts;
  for (const fn of presentListeners) fn(ts);
  stamps.push(ts);
  const cutoff = ts - KEEP_MS;
  let i = 0;
  while (i < stamps.length && stamps[i]! < cutoff) i++;
  if (i) stamps.splice(0, i);
  if (!el || stamps.length < 2) return;
  const fps = windowFps(ts, SHOW_MS);
  if (fps == null) return;
  const next = String(Math.round(fps));
  if (next === shown) return;
  shown = next;
  el.textContent = next;
}

export function setFpsHint(text: string): void {
  if (el) el.parentElement?.setAttribute("title", text);
}
