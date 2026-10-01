/**
 * #216: the sandbox boot waits (frame-ready, ready) run on a wall-clock timer. When the host main
 * thread is blocked (the Rocket Car Soccer ray-march sky compiles synchronously) the timer fires
 * long after its deadline, before the frame's answer is handled. A late fire yields one task,
 * then (still no answer) re-arms once with `step=deadline-restart reason=main-thread-blocked`.
 * A second late fire, or any on-time expiry, rejects once with the unchanged
 * `sandbox <type> timeout` (so the load-failed path shows the existing couldn't-start).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import { PluginSandbox, SANDBOX_BOOT_LATE_REARMS, setSandboxMsgTimeoutMs } from "./host";
import { PLUGIN_SOURCE } from "./sandbox-channel";
import { resetSandboxFrameRuntimeForTests } from "./sandbox-frame";
import { installSandboxTestHandshake, setSandboxTestHandshakeEnabled } from "./sandbox-test-harness";
import { SKY_WAIT_DRIFT_MS } from "../app/sky-wait";

const FRAME_ID = "21621621-6216-4216-8216-216216216216";
const WAIT_MS = 300;
const HOLD_KEY = "__zotoViz216HoldReady";
const STARTED_KEY = "__zotoViz216ModuleStarted";

let moduleSeq = 0;
/**
 * A pack module that has started evaluating and does not finish (so no `ready`) until released.
 * A fresh URL per boot: an already evaluated module would answer `ready` at once.
 */
function heldModule(): string {
  moduleSeq++;
  return `data:text/javascript,${encodeURIComponent(
    `// boot ${moduleSeq}\nglobalThis.${STARTED_KEY}();\nawait globalThis.${HOLD_KEY};\n`,
  )}`;
}

let skew = 0;
/** The host main thread was blocked: its clock jumped past the deadline by more than the drift. */
function blockMainThread(): void {
  skew += WAIT_MS + SKY_WAIT_DRIFT_MS * 2;
}

function restartLines(info: { mock: { calls: unknown[][] } }, type: string): number {
  return info.mock.calls.filter(
    (c) => c[0] === `[zoto-viz plugin] wait=${type} step=deadline-restart reason=main-thread-blocked`,
  ).length;
}

/** Counts how the boot settles (resolves / rejects, with each reject message). */
function track(boot: Promise<void>) {
  const rejects: string[] = [];
  const out = { resolves: 0, rejects };
  boot.then(() => { out.resolves++; }, (e: unknown) => { out.rejects.push(e instanceof Error ? e.message : String(e)); });
  return out;
}

/** Boots a held module; the thread blocks once the ready wait is armed (module evaluating). */
function bootHeld(release: Promise<void>) {
  Reflect.set(globalThis, HOLD_KEY, release);
  Reflect.set(globalThis, STARTED_KEY, blockMainThread);
  const box = new PluginSandbox();
  const boot = box.loadModuleUrl(heldModule(), ["viz.read"], {});
  return { box, boot, settled: track(boot) };
}

describe("#216: sandbox boot waits re-arm when the timer fires late on a blocked main thread", () => {
  beforeEach(() => {
    installSandboxTestHandshake();
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue(FRAME_ID);
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-sandbox-216");
    resetSandboxFrameRuntimeForTests();
    setSandboxMsgTimeoutMs(WAIT_MS);
    skew = 0;
    const realNow = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => realNow() + skew);
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setSandboxTestHandshakeEnabled(true);
    setPackAssetTokenForTests("_sandbox", "");
    setSandboxMsgTimeoutMs(15_000);
    resetSandboxFrameRuntimeForTests();
    Reflect.deleteProperty(globalThis, HOLD_KEY);
    Reflect.deleteProperty(globalThis, STARTED_KEY);
  });

  it("re-arms at most once", () => {
    expect(SANDBOX_BOOT_LATE_REARMS).toBe(1);
  });

  it("(a) late fire, then ready: boot resolves, 0 rejects, one restart line", async () => {
    const info = vi.spyOn(console, "info");
    let release = (): void => {};
    const { box, boot, settled } = bootHeld(new Promise<void>((r) => { release = r; }));

    await expect.poll(() => restartLines(info, "ready") + settled.resolves + settled.rejects.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(settled.rejects, "the late fire did not reject the boot").toEqual([]);
    release();
    await boot;
    expect(settled.resolves, "resolved once").toBe(1);
    expect(settled.rejects, "0 rejects").toEqual([]);
    expect(restartLines(info, "ready"), "one restart line").toBe(1);
    box.unload();
  });

  it("(b) late fire, re-arm, second late fire with no ready: exactly one sandbox ready timeout, one restart line", async () => {
    const info = vi.spyOn(console, "info");
    const { box, boot, settled } = bootHeld(new Promise<void>(() => {}));

    await expect.poll(() => restartLines(info, "ready") + settled.rejects.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(settled.rejects, "the first late fire re-armed").toEqual([]);
    blockMainThread(); // the re-armed window fires late too
    await expect(boot).rejects.toThrow(/^sandbox ready timeout$/);
    await Promise.resolve();
    expect(settled.rejects, "exactly one reject").toEqual(["sandbox ready timeout"]);
    expect(settled.resolves).toBe(0);
    expect(restartLines(info, "ready"), "exactly one restart line").toBe(1);
    box.unload();
  });

  it("(c) on-time expiry with no ready: rejects once with sandbox ready timeout, no restart line", async () => {
    const info = vi.spyOn(console, "info");
    Reflect.set(globalThis, HOLD_KEY, new Promise<void>(() => {}));
    Reflect.set(globalThis, STARTED_KEY, () => {});
    const box = new PluginSandbox();
    const boot = box.loadModuleUrl(heldModule(), ["viz.read"], {});
    const settled = track(boot);
    await expect(boot).rejects.toThrow(/^sandbox ready timeout$/);
    await Promise.resolve();
    expect(settled.rejects).toEqual(["sandbox ready timeout"]);
    expect(restartLines(info, "ready"), "no restart on an on-time expiry").toBe(0);
    box.unload();
  });

  it("frame-ready: late fire, then frame-ready: that wait does not reject, one restart line", async () => {
    setSandboxTestHandshakeEnabled(false);
    const info = vi.spyOn(console, "info");
    const box = new PluginSandbox();
    const boot = box.loadModuleUrl("about:blank", ["viz.read"], {});
    const settled = track(boot);
    await expect.poll(() => document.querySelector("iframe[sandbox]"), { timeout: 5_000 }).not.toBeNull();
    blockMainThread();
    await expect.poll(() => restartLines(info, "frame-ready") + settled.rejects.length, { timeout: 5_000 }).toBeGreaterThan(0);
    expect(settled.rejects, "the late fire did not reject the boot").toEqual([]);
    const iframe = document.querySelector("iframe[sandbox]");
    const frameWin = iframe instanceof HTMLIFrameElement ? iframe.contentWindow : null;
    window.dispatchEvent(new MessageEvent("message", { source: frameWin, data: { source: PLUGIN_SOURCE, type: "frame-ready" } }));
    // Past frame-ready the boot waits on ready, which this silent frame never sends (on time).
    await expect(boot).rejects.toThrow(/^sandbox ready timeout$/);
    expect(restartLines(info, "frame-ready"), "one restart line").toBe(1);
    box.unload();
  });
});
