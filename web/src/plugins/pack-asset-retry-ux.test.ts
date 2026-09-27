import { afterEach, describe, expect, it, vi } from "vitest";
import { Mosaic } from "../graph/mosaic";
import { PackAssetTokenInvalidError } from "../core/http";
import { packSandboxStartFailed, packReconnecting } from "./plugin-copy";
import {
  markSandboxStartupFailed,
  markSandboxStartupOk,
  resetPluginPackFeedState,
  setTileExpectsVizFeed,
} from "./plugin-pack-feed";
import { registerPackAssetRetry, resetPackAssetFrameState } from "./pack-asset-frame";
import {
  resetRebuildSleepForTests,
  runPackAssetProtectedLoad,
  retryPackAssetProtectedLoad,
  setRebuildSleepForTests,
} from "./pack-asset-rebuild";

function testMosaic(pane: HTMLElement, paneId: string): Mosaic {
  const wall = document.createElement("div");
  wall.appendChild(pane);
  document.body.appendChild(wall);
  const mosaic = new Mosaic({
    wall,
    sceneEl: document.createElement("div"),
    main: { currentMode: { id: paneId }, setCompactLabels: () => {}, relayout: () => {}, setMode: () => {} } as never,
    arcade: {},
    optsFor: () => ({}),
    onFocus: () => {},
    onPromote: () => {},
    onLayout: () => {},
    onCloseLast: () => {},
    sync: () => ({
      theme: { id: "midnight" } as never,
      filters: {},
      anim: {} as never,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
  });
  (mosaic as unknown as { panes: Map<string, HTMLElement> }).panes.set(paneId, pane);
  return mosaic;
}

describe("pack asset retry UX", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resetPackAssetFrameState();
    resetPluginPackFeedState();
    resetRebuildSleepForTests();
    vi.useRealTimers();
  });

  async function exhaustCap(
    tileId: string,
    pack: string,
    mosaic: Mosaic,
    load: () => Promise<void>,
  ): Promise<void> {
    const p = runPackAssetProtectedLoad(tileId, pack, mosaic, load);
    const settled = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    await settled;
  }

  it("(a) after cap shows focusable Retry under couldn't-start copy", async () => {
    vi.useFakeTimers();
    const tileId = "plugin:wifi";
    const pack = "Wi-Fi";
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    const mosaic = testMosaic(pane, tileId);
    setTileExpectsVizFeed(tileId, true);
    markSandboxStartupOk(tileId);
    await exhaustCap(tileId, pack, mosaic, async () => {
      throw new PackAssetTokenInvalidError("wifi");
    });
    const btn = pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe("Retry");
    expect(btn?.tabIndex).toBe(0);
    expect(pane.querySelector(".mosaic-pane-notice-text")?.textContent).toBe(packSandboxStartFailed(pack));
  });

  it("(b) Retry resets backoff to 1s, shows Reconnecting, and focuses the tile", async () => {
    vi.useFakeTimers();
    const sleeps: number[] = [];
    setRebuildSleepForTests((ms, signal) => new Promise((resolve, reject) => {
      sleeps.push(ms);
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      setTimeout(resolve, ms);
    }));
    const tileId = "plugin:wifi";
    const pack = "Wi-Fi";
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    const mosaic = testMosaic(pane, tileId);
    setTileExpectsVizFeed(tileId, true);
    let calls = 0;
    const load = async () => {
      calls += 1;
      throw new PackAssetTokenInvalidError("wifi");
    };
    await exhaustCap(tileId, pack, mosaic, load);
    const btn = pane.querySelector<HTMLButtonElement>(".mosaic-pane-notice-retry");
    expect(btn).toBeTruthy();
    sleeps.length = 0;
    calls = 0;
    registerPackAssetRetry(tileId, pack, () => {
      void retryPackAssetProtectedLoad(tileId, pack, mosaic, load).catch(() => {});
    });
    btn?.click();
    expect(pane.querySelector(".mosaic-pane-notice-text")?.textContent).toBe(packReconnecting(pack));
    expect(pane.classList.contains("mosaic-pane-reconnecting")).toBe(true);
    expect(document.activeElement).toBe(pane);
    const retrySettled = Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();
    expect(sleeps[0]).toBe(1000);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("changing pack mid-backoff does not paint reconnect/fail on the new pack", async () => {
    vi.useFakeTimers();
    setRebuildSleepForTests((ms, signal) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      setTimeout(resolve, ms);
    }));
    const tileId = "plugin:wifi";
    const packA = "Pack-A";
    const packB = "Pack-B";
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    const mosaic = testMosaic(pane, tileId);
    setTileExpectsVizFeed(tileId, true);
    let callsA = 0;
    const loadA = async () => {
      callsA += 1;
      throw new PackAssetTokenInvalidError("a");
    };
    const loadB = async () => {
      await Promise.resolve();
    };
    const pA = runPackAssetProtectedLoad(tileId, packA, mosaic, loadA);
    await vi.advanceTimersByTimeAsync(500);
    const pB = runPackAssetProtectedLoad(tileId, packB, mosaic, loadB);
    await vi.advanceTimersByTimeAsync(4000);
    await Promise.allSettled([pA, pB]);
    const text = pane.textContent ?? "";
    expect(text).not.toMatch(/Reconnecting Pack-A/);
    expect(text).not.toMatch(/couldn't start/i);
    expect(callsA).toBe(1);
    await expect(pB).resolves.toBeUndefined();
  });
});
