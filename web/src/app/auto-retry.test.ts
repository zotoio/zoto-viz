/**
 * The automatic retry of a tile that couldn't start: backoff 3 s, 10 s, 30 s, then every 60 s
 * (jittered ±20 %), one retry in flight per tile, the next step armed only by the next failure,
 * `forget` (manual Retry, a start that worked, the view switched) starts the backoff over, a
 * background tab pauses the wait, page unload drops it, and only a retryable Couldn't start is ever
 * retried (never missing, Needs you or can't draw).
 *
 * Fake timers; `random` is pinned at 0.5 (no jitter) unless a row says otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RETRY_JITTER,
  AUTO_RETRY_STEPS_MS,
  AutoRetries,
  autoRetryable,
  autoRetryDelayMs,
  type AutoRetryCheck,
} from "./auto-retry";
import type { ViewState } from "./view-state";

const KEY = "plugin:ant-colony";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(v: DocumentVisibilityState): void {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A tile whose notice is `notice` (same object = nothing happened) and whose check is `check`. */
function rig(opts: { random?: () => number } = {}) {
  const tile: { notice: object; check: AutoRetryCheck } = { notice: {}, check: "run" };
  const retries = new AutoRetries({
    check: () => tile.check,
    snapshot: () => tile.notice,
    random: opts.random ?? (() => 0.5),
    now: () => Date.now(),
  });
  return { tile, retries };
}

/** Times (ms since start) at which `run` was called while `ms` of fake time pass. */
function runTimes(run: { mock: { calls: unknown[][] } }, ms: number, stepMs = 100): number[] {
  const t0 = Date.now();
  const at: number[] = [];
  let seen = run.mock.calls.length;
  for (let t = 0; t < ms; t += stepMs) {
    vi.advanceTimersByTime(stepMs);
    while (run.mock.calls.length > seen) {
      at.push(Date.now() - t0);
      seen += 1;
    }
  }
  return at;
}

describe("auto-retry backoff", () => {
  let live: AutoRetries[] = [];
  let info: { mock: { calls: unknown[][] } };

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });

  afterEach(() => {
    for (const r of live.splice(0)) r.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function make(opts: { random?: () => number } = {}) {
    const r = rig(opts);
    live.push(r.retries);
    return r;
  }

  it("the steps are 3 s, 10 s, 30 s, then every 60 s", () => {
    expect(AUTO_RETRY_STEPS_MS).toEqual([3_000, 10_000, 30_000, 60_000]);
    expect([0, 1, 2, 3, 4, 9].map((n) => autoRetryDelayMs(n, () => 0.5))).toEqual([3_000, 10_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it("each step is jittered by at most ±20 %", () => {
    expect(AUTO_RETRY_JITTER).toBe(0.2);
    expect(autoRetryDelayMs(0, () => 0)).toBe(2_400);
    expect(autoRetryDelayMs(0, () => 1)).toBe(3_600);
    expect(autoRetryDelayMs(7, () => 0)).toBe(48_000);
    expect(autoRetryDelayMs(7, () => 1)).toBe(72_000);
    for (let i = 0; i < 50; i++) {
      const ms = autoRetryDelayMs(1);
      expect(ms).toBeGreaterThanOrEqual(8_000);
      expect(ms).toBeLessThanOrEqual(12_000);
    }
  });

  it("a tile that keeps failing is retried at 3 s, then 10 s, 30 s, 60 s, 60 s after each try", () => {
    const { retries } = make();
    const run = vi.fn();
    retries.schedule(KEY, run);
    // The notice never changes: every try counts as failed and arms the next step.
    const at = runTimes(run, 3_000 + 10_000 + 30_000 + 60_000 + 60_000 + 50);
    expect(at).toEqual([3_000, 13_000, 43_000, 103_000, 163_000]);
    expect(retries.attempts(KEY)).toBe(5);
  });

  it("logs each armed step as step=auto-retry n=… in_ms=…", () => {
    const { retries } = make();
    retries.schedule(KEY, vi.fn());
    vi.advanceTimersByTime(3_000);
    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(`[zoto-viz sky] tile=${KEY} step=auto-retry n=1 in_ms=3000`);
    expect(lines).toContain(`[zoto-viz sky] tile=${KEY} step=auto-retry-run n=1`);
    expect(lines).toContain(`[zoto-viz sky] tile=${KEY} step=auto-retry n=2 in_ms=10000`);
  });

  it("one retry waits per tile: a second failure report takes the newest action, never a second timer", () => {
    const { retries } = make();
    const first = vi.fn();
    const second = vi.fn();
    retries.schedule(KEY, first);
    vi.advanceTimersByTime(1_000);
    retries.schedule(KEY, second);
    vi.advanceTimersByTime(2_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("the next step is armed by the next failure only: a try that moved the tile on waits for it", () => {
    const { tile, retries } = make();
    const run = vi.fn(() => { tile.notice = { kind: "starting" }; });
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(retries.pending(KEY), "the try is in flight: nothing else is armed").toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    // The try failed again: its notice arms step 2 (10 s).
    retries.schedule(KEY, run);
    expect(runTimes(run, 10_050)).toEqual([10_000]);
  });

  it("a try that returns a promise is in flight until it settles; settling on the same notice arms the next step", async () => {
    const { retries } = make();
    let settle!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { settle = r; }));
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(3_000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(retries.pending(KEY)).toBe(false);
    settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(retries.pending(KEY)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("forget (a manual Retry or a start that worked) starts the backoff over at 3 s", () => {
    const { retries } = make();
    const run = vi.fn();
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(3_000 + 10_000);
    expect(run).toHaveBeenCalledTimes(2);
    retries.forget(KEY);
    expect(retries.pending(KEY)).toBe(false);
    expect(retries.attempts(KEY)).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(run).toHaveBeenCalledTimes(2);
    retries.schedule(KEY, run);
    expect(runTimes(run, 3_050)).toEqual([3_000]);
  });

  it("tiles back off on their own", () => {
    const { retries } = make();
    const a = vi.fn();
    const b = vi.fn();
    retries.schedule("a", a);
    vi.advanceTimersByTime(3_000 + 10_000);
    retries.schedule("b", b);
    vi.advanceTimersByTime(3_000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    retries.forget("a");
    vi.advanceTimersByTime(10_000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("the tile moved on (check drop, or its guard no longer holds): the retry is dropped, never run", () => {
    const { tile, retries } = make();
    const run = vi.fn();
    tile.check = "drop";
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(120_000);
    expect(run).not.toHaveBeenCalled();
    expect(retries.pending(KEY)).toBe(false);

    tile.check = "run";
    let still = true;
    retries.schedule(KEY, run, () => still);
    still = false;
    vi.advanceTimersByTime(120_000);
    expect(run).not.toHaveBeenCalled();
    expect(retries.pending(KEY)).toBe(false);
  });

  it("hold (a lost context) waits the same step again without counting a try", () => {
    const { tile, retries } = make();
    const run = vi.fn();
    tile.check = "hold";
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(3_000 * 4);
    expect(run).not.toHaveBeenCalled();
    expect(retries.attempts(KEY)).toBe(0);
    tile.check = "run";
    vi.advanceTimersByTime(3_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a background tab pauses the wait and the tab showing again resumes what was left", () => {
    const { retries } = make();
    const run = vi.fn();
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(1_000);
    setVisibility("hidden");
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).not.toHaveBeenCalled();
    expect(retries.pending(KEY), "paused, not dropped").toBe(true);
    setVisibility("visible");
    vi.advanceTimersByTime(1_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failure in a background tab arms nothing until the tab shows", () => {
    const { retries } = make();
    const run = vi.fn();
    setVisibility("hidden");
    retries.schedule(KEY, run);
    vi.advanceTimersByTime(10 * 60_000);
    expect(run).not.toHaveBeenCalled();
    setVisibility("visible");
    vi.advanceTimersByTime(3_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("page unload drops every retry", () => {
    const { retries } = make();
    const run = vi.fn();
    retries.schedule("a", run);
    retries.schedule("b", run);
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(120_000);
    expect(run).not.toHaveBeenCalled();
    expect(retries.pending("a") || retries.pending("b")).toBe(false);
  });

  it("a retry that throws still counts as a failed try and backs off", () => {
    const { retries } = make();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn(() => { throw new Error("boom"); });
    retries.schedule(KEY, run);
    expect(runTimes(run, 13_050)).toEqual([3_000, 13_000]);
  });
});

describe("autoRetryable: only a Couldn't start that a retry can fix", () => {
  it("timeout, load-failed and grant-failed are retried", () => {
    const reasons: Array<"timeout" | "load-failed" | "grant-failed"> = ["timeout", "load-failed", "grant-failed"];
    for (const reason of reasons) {
      expect(autoRetryable({ kind: "couldnt-start", reason, packId: "p" }), reason).toBe(true);
    }
  });

  it("missing, Needs you, can't draw, starting and ready never are", () => {
    const never: ViewState[] = [
      { kind: "couldnt-start", reason: "missing", packId: "p" },
      { kind: "needs-you", reason: "consent", packId: "p" },
      { kind: "needs-you", reason: "changed", packId: "p" },
      { kind: "cant-draw", reason: "shader", packId: "p" },
      { kind: "cant-draw", reason: "context-lost" },
      { kind: "starting" },
      { kind: "ready" },
    ];
    for (const s of never) expect(autoRetryable(s), JSON.stringify(s)).toBe(false);
    expect(autoRetryable(null)).toBe(false);
  });
});
