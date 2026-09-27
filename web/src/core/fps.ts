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

/**
 * Framerate badge for one pane. `mark` is one picture change in that pane.
 * `tick` ages the window so a pane that stops changing falls to 0.
 */
export class PaneFps {
  readonly el: HTMLElement;
  private stamps: number[] = [];
  private lastTs = -1;
  private shown = "";
  private fpsSuffix = "";
  private budgetLine: string | null = null;

  constructor(parent: HTMLElement) {
    const badge = document.createElement("span");
    badge.className = "pane-fps";
    badge.title = "how often this pane's picture changed in the last second";
    badge.textContent = "– fps";
    parent.append(badge);
    this.el = badge;
  }

  hint(text: string): void {
    this.el.title = text;
  }

  /** Compact adaptive render-scale readout on mosaic tiles. */
  setRenderScaleBadge(scale: number | null): void {
    if (scale == null) {
      this.fpsSuffix = "";
      if (!this.budgetLine) this.paint(performance.now());
      return;
    }
    this.budgetLine = null;
    const s = scale >= 0.999 ? "1" : scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    this.fpsSuffix = ` · ${s}`;
    this.paint(performance.now());
  }

  /** Full frame-budget overlay on the header / focused pane when mosaic hides the viz HUD. */
  setBudgetLine(line: string | null): void {
    if (!line) {
      this.budgetLine = null;
      this.paint(performance.now());
      return;
    }
    this.budgetLine = line;
    this.fpsSuffix = "";
    this.set(line);
  }

  /** This pane's pixels differed from the previous sample. */
  mark(ts: number): void {
    if (ts === this.lastTs) return;
    this.lastTs = ts;
    this.stamps.push(ts);
    this.expire(ts);
    this.paint(ts);
  }

  /** Drop changes older than a second and refresh the badge. Does not count a frame. */
  tick(now: number): void {
    this.expire(now);
    this.paint(now);
  }

  /** Kept so draw-cost probes can call in without changing the change-rate. */
  noteGpu(_ms: number): void { /* picture changes, not GPU elapsed time, own the badge */ }

  dispose(): void {
    this.el.remove();
  }

  private expire(now: number): void {
    const cutoff = now - SHOW_MS;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i]! < cutoff) i++;
    if (i) this.stamps.splice(0, i);
  }

  private paint(now: number): void {
    if (this.budgetLine) return;
    const loop = this.loopFps(now);
    if (loop == null) {
      if (this.lastTs >= 0 && now - this.lastTs >= SHOW_MS) this.set(`0 fps${this.fpsSuffix}`);
      return;
    }
    this.set(`${Math.round(loop)} fps${this.fpsSuffix}`);
  }

  private set(next: string): void {
    if (next === this.shown) return;
    this.shown = next;
    this.el.textContent = next;
  }

  private loopFps(now: number): number | null {
    if (this.stamps.length < 2) return null;
    const cutoff = now - SHOW_MS;
    let first = -1;
    let n = 0;
    for (const t of this.stamps) {
      if (t < cutoff) continue;
      if (first < 0) first = t;
      n++;
    }
    if (n < 2 || first < 0) return null;
    const span = this.stamps[this.stamps.length - 1]! - first;
    if (span < 80) return null;
    return ((n - 1) * 1000) / span;
  }
}
