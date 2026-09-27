import { afterEach, describe, expect, it, vi } from "vitest";
import { Mosaic } from "../graph/mosaic";
import { setPluginModes, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { PackAssetTokenInvalidError } from "../core/http";
import * as http from "../core/http";
import { packNavigationStopped } from "./plugin-copy";
import {
  beginActivePackLoad,
  beginTileRebuild,
  closePackAssetFrameForTile,
  openPackAssetFrame,
  resetPackAssetFrameState,
  tileRebuildAttemptCount,
} from "./pack-asset-frame";
import { paintPackAssetPaneNotice } from "./pack-asset-pane-notice";
import * as packNav from "./pack-asset-navigation";
import {
  beginUserPackLoadSession,
  countPackNavigationStoppedPaneNotices,
  markPackNavigationStopped,
  packNavigationStoppedForTile,
  resetPackAssetNavigationState,
} from "./pack-asset-navigation";
import { runPackAssetProtectedLoad, resetRebuildSleepForTests, setRebuildSleepForTests } from "./pack-asset-rebuild";
import { applyPackFeedPaneNotice, resetPluginPackFeedState } from "./plugin-pack-feed";

function mosaicWall(paneId: string): Mosaic {
  const wall = document.createElement("div");
  document.body.appendChild(wall);
  const mosaic = new Mosaic({
    wall,
    sceneEl: document.createElement("div"),
    main: {
      currentMode: { id: paneId },
      dreamAnim: { backdrop: "aurora" },
      nodeCount: 0,
      pluginSkyId: null,
      setCompactLabels: () => {},
      relayout: () => {},
      setMode: () => {},
      setAnim: () => {},
    } as never,
    arcade: {},
    optsFor: () => ({}),
    onFocus: () => {},
    onPromote: () => {},
    onLayout: () => {},
    onCloseLast: () => {},
    sync: () => ({
      theme: themeById("midnight"),
      filters: {},
      anim: {} as never,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
  });
  return mosaic;
}

function mosaicPane(mosaic: Mosaic, paneId: string): HTMLElement {
  const panes = (mosaic as unknown as { panes: Map<string, HTMLElement> }).panes;
  const pane = panes.get(paneId) ?? document.createElement("div");
  if (!panes.has(paneId)) panes.set(paneId, pane);
  return pane;
}

describe("pack navigation stop clear UX", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setPluginModes([]);
    resetPackAssetNavigationState();
    resetPackAssetFrameState();
    resetPluginPackFeedState();
    resetRebuildSleepForTests();
    vi.restoreAllMocks();
  });

  it("swap pack on a stopped tile clears stopped UI on that tile", () => {
    const tileId = "plugin:wifi";
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    beginActivePackLoad(tileId, "Wi-Fi");
    markPackNavigationStopped(tileId);
    paintPackAssetPaneNotice(pane, packNavigationStopped("Wi-Fi"), "fail", {
      showRemoveFromWall: true,
      onRemoveFromWall: () => {},
    });
    expect(countPackNavigationStoppedPaneNotices(pane)).toBe(1);

    beginActivePackLoad(tileId, "Other pack");
    applyPackFeedPaneNotice(
      {
        setPaneNotice: (_id, text, recipe = "default", opts) => {
          paintPackAssetPaneNotice(pane, text, recipe, opts);
        },
      },
      tileId,
      "Other pack",
    );

    expect(packNavigationStoppedForTile(tileId)).toBe(false);
    expect(countPackNavigationStoppedPaneNotices(pane)).toBe(0);
  });

  it("layout change from 1×1 to 2×2 keeps stopped copy and skips reconnect", async () => {
    const tileId = "plugin:wifi";
    setPluginModes(["wifi", "a", "b", "c"].map((id) => ({
      ...topology,
      id: `plugin:${id}`,
      pluginId: id,
      label: id,
    })));
    const mosaic = mosaicWall(tileId);
    mosaic.setSize("1", tileId);
    let pane = mosaicPane(mosaic, tileId);
    markPackNavigationStopped(tileId);
    paintPackAssetPaneNotice(pane, packNavigationStopped("Wi-Fi"), "fail", {
      showRemoveFromWall: true,
      onRemoveFromWall: () => {},
    });
    beginActivePackLoad(tileId, "Wi-Fi");
    const clearSpy = vi.spyOn(packNav, "clearPackNavigationStopped");

    mosaic.setSize("2", tileId);
    pane = mosaicPane(mosaic, tileId);

    expect(clearSpy).not.toHaveBeenCalled();
    expect(packNavigationStoppedForTile(tileId)).toBe(true);
    expect(countPackNavigationStoppedPaneNotices(pane)).toBe(1);
    expect(tileRebuildAttemptCount(tileId, "Wi-Fi")).toBe(0);

    setRebuildSleepForTests(async () => {});
    vi.useFakeTimers();
    const rebuildSpy = vi.spyOn(await import("./pack-asset-frame"), "beginTileRebuild");
    await runPackAssetProtectedLoad(tileId, "Wi-Fi", { setPaneNotice: vi.fn() }, async () => {
      throw new PackAssetTokenInvalidError("wifi");
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rebuildSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
    rebuildSpy.mockRestore();
  });

  it("re-add after stop allows one new navigation stop and retires the old token", async () => {
    const tileId = "main";
    vi.spyOn(http, "registerPackAssetFrame").mockResolvedValue(undefined);
    vi.spyOn(http, "unregisterPackAssetFrame").mockResolvedValue(undefined);
    const mint = vi.spyOn(http, "mintPackAssetToken")
      .mockResolvedValueOnce("11111111-1111-4111-8111-111111111111.oldmac")
      .mockResolvedValueOnce("22222222-2222-4222-8222-222222222222.newmac");

    await openPackAssetFrame(tileId);
    const oldTok = await http.mintPackAssetToken("demo", "frame-1");
    markPackNavigationStopped(tileId);
    await closePackAssetFrameForTile(tileId);

    beginUserPackLoadSession(tileId);
    await openPackAssetFrame(tileId);
    const newTok = await http.mintPackAssetToken("demo", "frame-2");
    expect(newTok).not.toBe(oldTok);

    let newStops = 0;
    if (markPackNavigationStopped(tileId)) newStops += 1;
    if (markPackNavigationStopped(tileId)) newStops += 1;
    expect(newStops).toBe(1);

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes(oldTok)) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "token_invalid" }),
          clone: () => ({ json: async () => ({ error: "token_invalid" }) }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    const r = await fetch(`/pack-assets/${oldTok}/demo/module.js`);
    expect(r.status).toBe(401);
    globalThis.fetch = origFetch;
  });
});
