import type { ViewState } from "./view-state";

/**
 * Waits between a tile's automatic retries after it couldn't start; the last one repeats. Panes run
 * live and never need a click: the Retry button stays as a fallback.
 */
export const AUTO_RETRY_STEPS_MS: readonly number[] = [3_000, 10_000, 30_000, 60_000];

/** Each wait moves by up to this fraction either way, so a wall of failed tiles never retries in step. */
export const AUTO_RETRY_JITTER = 0.2;

/** The wait before automatic retry `n + 1` (0-based `n` retries already made). */
export function autoRetryDelayMs(n: number, random: () => number = Math.random): number {
  const base = AUTO_RETRY_STEPS_MS[Math.min(Math.max(0, n), AUTO_RETRY_STEPS_MS.length - 1)]!;
  return Math.round(base * (1 + (random() * 2 - 1) * AUTO_RETRY_JITTER));
}

/**
 * Retried on its own: a load that failed, timed out or could not save its OK. Never a view that is
 * not installed (`missing`), Needs you (the operator's answer), or can't draw (a shader that fails
 * to compile fails the same way again; a lost context has its own rerun, #216).
 */
export function autoRetryable(state: ViewState | null | undefined): boolean {
  return state?.kind === "couldnt-start" && state.reason !== "missing";
}

/** At a retry's time: run it, hold it a step (the context is lost), or drop it (the tile moved on). */
export type AutoRetryCheck = "run" | "hold" | "drop";

export interface AutoRetryHost {
  check: (key: string) => AutoRetryCheck;
  /**
   * The tile's current notice (compared by identity). A retry that settles with the very same notice
   * still up did nothing (no Starting, no new failure, no ready): that counts as a failed try.
   */
  snapshot: (key: string) => unknown;
  random?: () => number;
  now?: () => number;
}

type Entry = {
  /** Automatic retries made since the last reset. */
  n: number;
  run: () => unknown;
  still: () => boolean;
  timer: ReturnType<typeof setTimeout> | null;
  due: number;
  /** Paused in a background tab: the wait still to go once the tab shows. */
  left?: number;
};

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof v === "object" && "then" in v && typeof v.then === "function";
}

/**
 * One automatic retry per tile, on backoff (AUTO_RETRY_STEPS_MS, jittered). The next step is armed
 * only by the next failure, so there is never more than one retry in flight. `forget` (a manual
 * Retry, a start that worked, the view switched or the pane removed) drops the timer and the count.
 * A background tab pauses every wait (the sky-wait rule, #237); page unload drops them all.
 */
export class AutoRetries {
  private readonly entries = new Map<string, Entry>();
  private watching = false;
  private readonly onVisibility = (): void => {
    if (pageHidden()) this.pauseHidden();
    else this.resumeVisible();
  };
  private readonly onPageHide = (): void => this.dispose();

  constructor(private readonly host: AutoRetryHost) {}

  /** The tile couldn't start: arm its next retry, unless one is already waiting (that one takes `run`). */
  schedule(key: string, run: () => unknown, still: () => boolean = () => true): void {
    const cur = this.entries.get(key);
    if (cur) {
      cur.run = run;
      cur.still = still;
      if (cur.timer || cur.left !== undefined) return;
      this.arm(key, cur, autoRetryDelayMs(cur.n, this.host.random));
      return;
    }
    const e: Entry = { n: 0, run, still, timer: null, due: 0 };
    this.entries.set(key, e);
    this.arm(key, e, autoRetryDelayMs(0, this.host.random));
  }

  /** Drop the tile's retry and its backoff: the next failure starts again at the first step. */
  forget(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    this.entries.delete(key);
    if (this.entries.size === 0) this.unwatch();
  }

  /** A retry is waiting for this tile (armed or paused). */
  pending(key: string): boolean {
    const e = this.entries.get(key);
    return !!e && (!!e.timer || e.left !== undefined);
  }

  /** Automatic retries made for this tile since its last reset. */
  attempts(key: string): number {
    return this.entries.get(key)?.n ?? 0;
  }

  dispose(): void {
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer);
    this.entries.clear();
    this.unwatch();
  }

  private now(): number {
    return this.host.now?.() ?? performance.now();
  }

  private arm(key: string, e: Entry, ms: number): void {
    this.watch();
    if (pageHidden()) {
      e.timer = null;
      e.left = ms;
      console.info(`[zoto-viz sky] tile=${key} step=auto-retry-pause reason=hidden n=${e.n + 1} left_ms=${ms}`);
      return;
    }
    e.left = undefined;
    e.due = this.now() + ms;
    e.timer = setTimeout(() => this.fire(key, e), ms);
    console.info(`[zoto-viz sky] tile=${key} step=auto-retry n=${e.n + 1} in_ms=${ms}`);
  }

  private fire(key: string, e: Entry): void {
    if (this.entries.get(key) !== e) return;
    e.timer = null;
    if (pageHidden()) {
      e.left = 0;
      return;
    }
    const check = e.still() ? this.host.check(key) : "drop";
    if (check === "drop") {
      this.forget(key);
      return;
    }
    if (check === "hold") {
      console.info(`[zoto-viz sky] tile=${key} step=auto-retry-hold reason=context-lost n=${e.n + 1}`);
      this.arm(key, e, autoRetryDelayMs(e.n, this.host.random));
      return;
    }
    e.n += 1;
    const before = this.host.snapshot(key);
    console.info(`[zoto-viz sky] tile=${key} step=auto-retry-run n=${e.n}`);
    const settled = (): void => {
      if (this.entries.get(key) !== e || e.timer || e.left !== undefined) return;
      if (this.host.snapshot(key) === before) this.arm(key, e, autoRetryDelayMs(e.n, this.host.random));
    };
    let out: unknown;
    try {
      out = e.run();
    } catch (err) {
      console.warn("zoto-viz auto-retry:", key, err);
    }
    if (isThenable(out)) out.then(settled, settled);
    else settled();
  }

  private pauseHidden(): void {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (!e.timer) continue;
      clearTimeout(e.timer);
      e.timer = null;
      e.left = Math.max(0, Math.round(e.due - now));
      console.info(`[zoto-viz sky] tile=${key} step=auto-retry-pause reason=hidden n=${e.n + 1} left_ms=${e.left}`);
    }
  }

  private resumeVisible(): void {
    for (const [key, e] of this.entries) {
      if (e.timer || e.left === undefined) continue;
      this.arm(key, e, e.left);
    }
  }

  private watch(): void {
    if (this.watching || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
    this.watching = true;
  }

  private unwatch(): void {
    if (!this.watching) return;
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
    this.watching = false;
  }
}
