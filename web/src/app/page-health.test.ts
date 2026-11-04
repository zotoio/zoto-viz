import { describe, expect, it, vi } from "vitest";
import { ErrorReporter, guardedReload, heartbeatBody, installGlobalErrorReporting, MIN_RELOAD_GAP_MS, softReloadDue } from "./page-health";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("ErrorReporter", () => {
  it("collapses a per-frame throw into one report with a count, then cools down", () => {
    const post = vi.fn(async (_path: string, _body: unknown) => undefined);
    let now = 0;
    const queued: (() => void)[] = [];
    const r = new ErrorReporter(post, 2000, 60_000, () => now, (fn) => { queued.push(fn); return 1; });
    for (let i = 0; i < 120; i++) r.report("render-frame", "TypeError: x is undefined", "mosaic");
    queued.shift()!();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({ kind: "render-frame", count: 120 });
    now = 30_000; r.report("render-frame", "TypeError: x is undefined", "mosaic");
    expect(queued).toHaveLength(0);
    now = 61_000; r.report("render-frame", "TypeError: x is undefined", "mosaic");
    expect(queued).toHaveLength(1);
  });

  it("global handlers report errors and unhandled rejections", () => {
    const report = vi.fn();
    const t = new EventTarget();
    installGlobalErrorReporting(t, { report });
    t.dispatchEvent(Object.assign(new Event("error"), { message: "boom", filename: "http://h/src/graph/mosaic.ts", lineno: 1251, colno: 3, error: new TypeError("bad") }));
    const rej = Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") });
    t.dispatchEvent(rej);
    const calls = report.mock.calls;
    expect(calls[0][0]).toBe("error");
    expect(calls[0][2]).toBe("src/graph/mosaic.ts:1251:3");
    expect(calls[1][0]).toBe("unhandledrejection");
    expect(calls[1][1]).toMatch(/nope/);
  });
});

describe("watchdog helpers", () => {
  it("heartbeat carries fps, audio contexts and visibility", () => {
    const b = heartbeatBody(59.94, 12.4, { visibilityState: "visible" });
    expect(b).toMatchObject({ fps: 59.9, uptimeS: 12, visible: true, audioContexts: 0 });
  });
  it("reloads at most once per guard window", () => {
    const store = memStore(); const reload = vi.fn();
    expect(guardedReload("x", 1_000_000, store, reload)).toBe(true);
    expect(guardedReload("x", 1_000_000 + MIN_RELOAD_GAP_MS - 1, store, reload)).toBe(false);
    expect(guardedReload("x", 1_000_000 + MIN_RELOAD_GAP_MS + 1, store, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("soft reload waits for uptime, quiet input and no speech", () => {
    const cfg = { softReloadAfterH: 12, softReloadQuietMs: 300_000 };
    const h12 = 12 * 3_600_000;
    expect(softReloadDue(cfg, h12 - 1, 1e9, false)).toBe(false);
    expect(softReloadDue(cfg, h12, 299_999, false)).toBe(false);
    expect(softReloadDue(cfg, h12, 300_000, true)).toBe(false);
    expect(softReloadDue(cfg, h12, 300_000, false)).toBe(true);
    expect(softReloadDue({ ...cfg, softReloadAfterH: 0 }, 1e12, 1e12, false)).toBe(false);
  });
});
