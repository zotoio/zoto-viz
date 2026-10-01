import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackAssetTokenInvalidError, setPackAssetTokenForTests } from "../core/http";
import { loadShippedPackSpec } from "../plugins/fixtures/host-idle-shipped-packs";
import { PluginSandbox, sandboxSetSizesForTests, setPluginModuleSandboxUrlForTests } from "../plugins/host";
import { resetRebuildSleepForTests, setRebuildSleepForTests } from "../plugins/pack-asset-rebuild";
import type { PluginView } from "../plugins/plugin";
import { bindVizDriveElement, noteSandboxWrite, resetVizDriveState, vizDriveFor } from "../plugins/viz-drive";
import { attachPaneSandbox, TileSandboxes } from "./tile-sandboxes";

/**
 * #242 (follow-up to #233), on real PluginSandboxes and main.ts's own pane attach (attachPaneSandbox).
 * N4: a restarted pane's old attach that settles late must not clear the new sandbox's drive.
 * F1: a restart stops the old attach, whether it waits on the pre-attach import (iii) or on the
 * asset rebuild's retry sleep (iv). F2: a drop during the real retry sleep aborts the rebuild, clears
 * its timer and ends the pane's pack load (v).
 * Reverts: N4 the dropReady guard (host.ts), F1 `prev.abort.abort()` in load(), F2 the stopRebuild
 * listener in attachPaneSandbox and the sleep's clearTimeout (pack-asset-rebuild.ts).
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BACKROOMS: PluginView = { ...loadShippedPackSpec(REPO, "backrooms"), hash: "h-backrooms", has_frontend: true };
const LABEL = BACKROOMS.name ?? BACKROOMS.id;
const PANE = BACKROOMS.id;
const DRIVEN = "topology";

describe("#242 pane sandboxes: restart and drop stop the old attach", () => {
  const made: PluginSandbox[] = [];
  let opened = 0;
  let packAssetFrame: typeof import("../plugins/pack-asset-frame");

  beforeEach(async () => {
    packAssetFrame = await import("../plugins/pack-asset-frame");
    opened = 0;
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
    resetVizDriveState();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const sb of made.splice(0)) sb.unload();
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
    resetRebuildSleepForTests();
    resetVizDriveState();
  });

  function paneTiles(): TileSandboxes<PluginSandbox> {
    const box = (): PluginSandbox => {
      const sb = new PluginSandbox();
      made.push(sb);
      return sb;
    };
    return new TileSandboxes<PluginSandbox>({
      main: box(),
      create: box,
      drivenTile: () => DRIVEN,
      target: () => null,
      mayLoad: () => true,
      attach: (sb, spec, tileId, config, signal) => attachPaneSandbox(sb, spec, tileId, config, signal, null),
    });
  }

  /** Bounded below the test timeout: a pane that never boots fails this check instead of timing out. */
  async function untilReady(tiles: TileSandboxes<PluginSandbox>): Promise<void> {
    await vi.waitFor(() => {
      expect(tiles.readyPackFor(PANE), "the restarted pane boots its pack").toBe(BACKROOMS.id);
    }, { timeout: 3_000 });
  }

  /** The restarted pane's attach reached its load: an old attach not stopped has loaded by now. */
  async function untilFreshLoads(tiles: TileSandboxes<PluginSandbox>): Promise<void> {
    const freshLoads = vi.spyOn(tiles.sandboxFor(PANE), "loadModule");
    await settle(() => freshLoads.mock.calls.length > 0);
    expect(freshLoads, "the restarted pane's attach reached its load").toHaveBeenCalled();
  }

  /** Real macrotasks (fake timers only fake setTimeout / clearTimeout). */
  async function settle(until: () => boolean, max = 200): Promise<void> {
    for (let i = 0; i < max && !until(); i++) await new Promise<void>((r) => { setImmediate(r); });
  }

  /** True once `p` settles, false after `ms` (real timers): a hung attach fails a check, not the row. */
  async function settlesWithin(p: Promise<unknown>, ms = 1_000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms); });
    const done = await Promise.race([p.then(() => true, () => true), late]);
    clearTimeout(timer);
    return done;
  }

  /** After the restart settled and the pane dropped: nothing of the replaced sandbox is left. */
  function expectReplacedGone(old: PluginSandbox, base: { live: number; ready: number }): void {
    expect.soft(old.readyPack, "readyPack of the replaced sandbox").toBe("");
    expect.soft(sandboxSetSizesForTests(), "live / ready sandboxes after the pane drops").toEqual(base);
    expect.soft(document.querySelectorAll("iframe"), "iframes left after the pane drops").toHaveLength(0);
  }

  it("(N4) a restarted pane's old attach settling late leaves the new sandbox's drive at sandbox", async () => {
    bindVizDriveElement(PANE, document.createElement("div"));
    let inOpen = false;
    let release = (): void => {};
    // The old attach's frame request cannot be cancelled: it answers after the restart is ready.
    vi.mocked(packAssetFrame.openPackAssetFrame).mockImplementationOnce(() => new Promise<string>((resolve) => {
      inOpen = true;
      release = () => resolve("ffffffff-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    }));
    const tiles = paneTiles();
    const first = tiles.load(PANE, BACKROOMS);
    const old = tiles.sandboxFor(PANE);
    await vi.waitFor(() => { expect(inOpen, "the old attach waits on its frame request").toBe(true); });
    await tiles.restart(PANE);
    await untilReady(tiles);
    const fresh = tiles.sandboxFor(PANE);
    expect(fresh, "the restart made a new sandbox").not.toBe(old);
    noteSandboxWrite(PANE); // the new sandbox writes (host.ts notes every write for its tile)
    expect(vizDriveFor(PANE), "drive once the new sandbox wrote").toBe("sandbox");
    release();
    await first; // the old attach settles: its late unload (and the backstop) run now
    expect.soft(vizDriveFor(PANE), "the restarted pane's drive after the old attach settles late").toBe("sandbox");
    expect.soft(fresh.readyPack, "the new sandbox stays ready").toBe(BACKROOMS.id);
  });

  it("(iii) restarted during the pre-attach wait (the import): the old attach never loads", async () => {
    const tiles = paneTiles();
    const base = sandboxSetSizesForTests();
    const first = tiles.load(PANE, BACKROOMS); // its attach now waits on the import
    const old = tiles.sandboxFor(PANE);
    const oldLoads = vi.spyOn(old, "loadModule");
    const restarted = tiles.restart(PANE);
    await untilFreshLoads(tiles); // the import resolved for both attaches, the old one first
    expect.soft(oldLoads, "loadModule on the replaced sandbox after the restart").toHaveBeenCalledTimes(0);
    await untilReady(tiles);
    expect.soft(await settlesWithin(first), "the old attach settles").toBe(true);
    expect.soft(await settlesWithin(restarted), "the restart settles").toBe(true);
    tiles.drop(PANE);
    expectReplacedGone(old, base);
  });

  it("(iv) restarted during the asset rebuild's retry sleep: the old sleep is aborted and never retries", async () => {
    const sleeps: AbortSignal[] = [];
    let entered = (): void => {};
    const sleeping = new Promise<void>((r) => { entered = r; });
    let wake = (): void => {};
    setRebuildSleepForTests((_ms, signal) => new Promise<void>((resolve, reject) => {
      sleeps.push(signal);
      wake = resolve;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      entered();
    }));
    vi.mocked(packAssetFrame.openPackAssetFrame).mockRejectedValueOnce(new PackAssetTokenInvalidError(BACKROOMS.id));
    const tiles = paneTiles();
    const base = sandboxSetSizesForTests();
    const first = tiles.load(PANE, BACKROOMS);
    const old = tiles.sandboxFor(PANE);
    await sleeping; // the first load hit an invalid token; the rebuild waits to retry
    const oldLoads = vi.spyOn(old, "loadModule");
    const restarted = tiles.restart(PANE);
    expect.soft(sleeps[0]?.aborted, "the old rebuild's sleep is aborted by the restart").toBe(true);
    wake(); // the sleep ends: a retry that was not stopped would boot the replaced sandbox now
    await untilFreshLoads(tiles);
    expect.soft(oldLoads, "loadModule on the replaced sandbox after the restart").toHaveBeenCalledTimes(0);
    await untilReady(tiles);
    expect.soft(await settlesWithin(first), "the old attach settles").toBe(true);
    expect.soft(await settlesWithin(restarted), "the restart settles").toBe(true);
    tiles.drop(PANE);
    expectReplacedGone(old, base);
  });

  it("(v) dropped during the real retry sleep: the rebuild is aborted, its timer cleared, the pack load ended", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const rebuilds = vi.spyOn(packAssetFrame, "registerPackAssetRebuildAbort");
    vi.mocked(packAssetFrame.openPackAssetFrame).mockRejectedValueOnce(new PackAssetTokenInvalidError(BACKROOMS.id));
    const tiles = paneTiles();
    const timers = vi.getTimerCount();
    const loading = tiles.load(PANE, BACKROOMS);
    const dropped = tiles.sandboxFor(PANE);
    await settle(() => packAssetFrame.tileRebuildInFlight(PANE, LABEL));
    expect(packAssetFrame.tileRebuildInFlight(PANE, LABEL), "the rebuild waits to retry").toBe(true);
    expect(vi.getTimerCount(), "the retry sleep's timer is armed").toBeGreaterThan(timers);
    const rebuild = rebuilds.mock.calls.at(-1)?.[2];
    const loads = vi.spyOn(dropped, "loadModule");
    tiles.drop(PANE);
    await settle(() => false, 20);
    expect.soft(rebuild?.signal.aborted, "the rebuild's abort signal (its sleep's) after the drop").toBe(true);
    expect.soft(vi.getTimerCount(), "pending timers vs before the load").toBe(timers);
    expect.soft(packAssetFrame.isActivePackLoad(PANE, LABEL), "the pane's pack load is still active").toBe(false);
    expect.soft(loads, "loadModule on the dropped sandbox after the drop").toHaveBeenCalledTimes(0);
    await vi.runOnlyPendingTimersAsync(); // lets a sleep that was not stopped end, so the row settles
    await loading;
  });
});
