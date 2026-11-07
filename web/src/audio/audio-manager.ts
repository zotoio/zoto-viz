/**
 * One place that creates and closes every AudioContext in the page.
 *
 * Each running AudioContext owns a real-time audio thread that renders a quantum every ~3 ms,
 * even when silent. A context that is created per utterance and never closed (a hung `resume()`
 * or a stalled stream read skips the `finally`) therefore leaks a thread and steady CPU; a 22 h
 * wall had 629 of them pegging ~11 cores. This module:
 *  - counts live contexts (`liveAudioContexts()`, reported by the page heartbeat),
 *  - hands out one lazy shared context for short-lived playback (TTS), suspended when idle,
 *  - gives `withTimeout` so a `resume()` or `read()` that never settles cannot pin a context.
 */

let live = 0;
const tracked = new WeakSet<BaseAudioContext>();

type Ctor = new (opts?: AudioContextOptions) => AudioContext;

function ctor(): Ctor | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Live (created, not yet closed) contexts made through this module. */
export function liveAudioContexts(): number { return live; }

/** Create a tracked AudioContext, or null when Web Audio is unavailable. */
export function createAudioContext(opts?: AudioContextOptions): AudioContext | null {
  const C = ctor();
  if (!C) return null;
  const ctx = opts ? new C(opts) : new C();
  tracked.add(ctx);
  live++;
  return ctx;
}

/** Close a context made by `createAudioContext`; safe to call twice. */
export function closeAudioContext(ctx: AudioContext | null | undefined): void {
  if (!ctx) return;
  if (tracked.has(ctx)) {
    tracked.delete(ctx);
    live = Math.max(0, live - 1);
  }
  if (ctx.state !== "closed") void ctx.close().catch(() => undefined);
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) { super(`${what} timed out after ${ms} ms`); this.name = "TimeoutError"; }
}

/** Reject if `p` does not settle within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Defaults; tests and settings may override via `configureSharedAudio`. */
export const sharedAudioConfig = {
  /** suspend the shared context this long after the last user releases it */
  idleSuspendMs: 4_000,
  /** a `resume()` that has not settled by then is treated as blocked (autoplay policy / device) */
  resumeTimeoutMs: 3_000,
};

export function configureSharedAudio(p: Partial<typeof sharedAudioConfig>): void {
  Object.assign(sharedAudioConfig, p);
}

let shared: AudioContext | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Borrow the shared context. Resolves null when Web Audio is missing or the context cannot
 * resume in time; otherwise the caller must call `releaseSharedAudio()` exactly once.
 */
export async function acquireSharedAudio(): Promise<AudioContext | null> {
  if (!shared || shared.state === "closed") {
    if (shared) closeAudioContext(shared);
    shared = createAudioContext();
    if (!shared) return null;
  }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  users++;
  const ctx = shared;
  if (ctx.state !== "running") {
    try {
      await withTimeout(ctx.resume(), sharedAudioConfig.resumeTimeoutMs, "AudioContext.resume");
    } catch {
      releaseSharedAudio();
      return null;
    }
  }
  return ctx;
}

/** True while something (TTS) is playing on the shared context. */
export function sharedAudioInUse(): boolean { return users > 0; }

export function releaseSharedAudio(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !shared) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (users === 0 && shared && shared.state === "running") void shared.suspend().catch(() => undefined);
  }, sharedAudioConfig.idleSuspendMs);
}

/** Test hook: drop the shared context and counters. */
export function resetAudioManagerForTests(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (shared) closeAudioContext(shared);
  shared = null;
  users = 0;
  live = 0;
}
