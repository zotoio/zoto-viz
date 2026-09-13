/**
 * Display framerate of the live UI. Several rAF loops (graph, mosaic tiles, arcade, feed)
 * share one vsync timestamp; marking the same timestamp twice does not count as two frames,
 * so a 2×2 mosaic still reads as ~60 fps when the main thread is keeping up.
 */

const WINDOW_MS = 1000;
const stamps: number[] = [];
let lastTs = -1;
let shown = "";
let el: HTMLElement | null = null;

export function bindFps(target: HTMLElement): void {
  el = target;
}

/** Call from every animation callback with that callback's rAF timestamp. */
export function markFrame(ts: number): void {
  if (ts === lastTs) return;
  lastTs = ts;
  stamps.push(ts);
  const cutoff = ts - WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i]! < cutoff) i++;
  if (i) stamps.splice(0, i);
  if (!el || stamps.length < 2) return;
  const span = stamps[stamps.length - 1]! - stamps[0]!;
  if (span < 80) return;
  const next = String(Math.round(((stamps.length - 1) * 1000) / span));
  if (next === shown) return;
  shown = next;
  el.textContent = next;
}
