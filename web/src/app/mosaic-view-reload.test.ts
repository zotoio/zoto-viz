import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "../ui/ui";
import { Settings } from "../ui/settings";
import { DEFAULT_DREAM } from "../graph/scene";
import { RenderHost } from "../graph/render-host";
import { Mosaic } from "../graph/mosaic";
import { NetScene, DEFAULT_DREAM as dream } from "../graph/scene";
import { themeById } from "../core/themes";
import { setPluginModes, talkers, topology } from "../core/modes";
import {
  reconcileMosaicTilesWithMode,
  resolveRestoredViewMode,
  viewMountState,
} from "./boot-view-restore";
import {
  resetPaneSwitchTokens,
  switchPaneView,
  type SwitchPaneViewHost,
} from "./switch-pane-view";

const MODES = [
  { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
  { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
  { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
  { ...topology, id: "plugin:backrooms", pluginId: "backrooms", label: "Backrooms" },
  { ...topology, id: "plugin:kefrens", pluginId: "kefrens", label: "Kefrens" },
];

function mosaicHost(over: Partial<SwitchPaneViewHost> & Pick<SwitchPaneViewHost, "tileIds">): SwitchPaneViewHost {
  return {
    focusedId: "",
    mainTileId: "",
    setPaneView: vi.fn(() => true),
    setPaneNotice: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

function makeLiveMosaic(tiles: string[], focus: string): Mosaic {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
  const sceneEl = document.createElement("div");
  Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
  Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
  const host = new RenderHost(wall, { software: true });
  const main = new NetScene(sceneEl, { host });
  main.retargetPanel(tiles[0] ?? "plugin:topology");
  const mosaic = new Mosaic({
    wall,
    sceneEl,
    main,
    host,
    arcade: {},
    optsFor: () => ({}),
    onFocus: () => {},
    onPromote: () => {},
    onLayout: () => {},
    onCloseLast: () => {},
    sync: () => ({
      theme: themeById("midnight"),
      filters: {},
      anim: dream,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
  });
  mosaic.setSize("4", focus, "off", { tiles });
  mosaic.focus(focus);
  return mosaic;
}

describe("mosaic view reload regressions (B/C/D/E)", () => {
  beforeEach(() => {
    setPluginModes(MODES);
    localStorage.clear();
  });

  afterEach(() => {
    setPluginModes([]);
    resetPaneSwitchTokens();
    localStorage.clear();
  });

  it("B: 1× reload keeps header and main mode aligned via persisted zoto-viz.mode", () => {
    const storageKey = "zoto-viz.mode";
    const header = new Select({
      id: "mode",
      caption: "view",
      options: MODES.map((m) => ({ value: m.id, label: m.label })),
      onChange: (id) => {
        localStorage.setItem(storageKey, id);
      },
    });
    header.value = "plugin:backrooms";
    header.onChange("plugin:backrooms", { value: "plugin:backrooms", label: "Backrooms" });

    const bootMode = resolveRestoredViewMode({
      sessionMode: undefined,
      localMode: localStorage.getItem(storageKey),
      fallback: "plugin:topology",
    });
    expect(bootMode).toBe("plugin:backrooms");
    expect(viewMountState({
      headerModeId: header.value,
      sceneModeId: bootMode,
      pluginActiveId: "backrooms",
    })).toBe(true);
  });

  it("C: header pick swaps the focused tile (not header-only)", async () => {
    const tiles = ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"];
    const mosaic = makeLiveMosaic(tiles, "plugin:kefrens");
    const realSetPaneView = mosaic.setPaneView.bind(mosaic);
    const m = mosaicHost({
      tileIds: mosaic.tileIds,
      focusedId: "plugin:kefrens",
      setPaneView: (from, to) => realSetPaneView(from, to),
      focus: (id) => mosaic.focus(id),
    });
    const persist = vi.fn();
    const result = await switchPaneView(m, "plugin:backrooms", {
      ensureReviewed: async () => true,
      spec: { name: "Backrooms" },
      teardownView: vi.fn(),
      mountView: vi.fn(),
      persistLayout: persist,
    });
    expect(result.ok).toBe(true);
    expect(mosaic.tileIds).toContain("plugin:backrooms");
    expect(mosaic.tileIds).not.toContain("plugin:kefrens");
    expect(mosaic.focusedId).toBe("plugin:backrooms");
    expect(persist).toHaveBeenCalled();
  });

  it("D: neighbour pane pick does not teardown the focused tile view", async () => {
    const tiles = ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"];
    const mosaic = makeLiveMosaic(tiles, "plugin:kefrens");
    const teardownView = vi.fn();
    const mountView = vi.fn();
    const realSetPaneView = mosaic.setPaneView.bind(mosaic);
    const m = mosaicHost({
      tileIds: mosaic.tileIds,
      focusedId: "plugin:kefrens",
      setPaneView: (from, to) => realSetPaneView(from, to),
      focus: (id) => mosaic.focus(id),
    });
    await switchPaneView(m, "plugin:backrooms", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => true,
      spec: null,
      teardownView,
      mountView,
      persistLayout: vi.fn(),
    });
    expect(teardownView).toHaveBeenCalledTimes(1);
    expect(teardownView).toHaveBeenCalledWith("plugin:topology");
    expect(teardownView).not.toHaveBeenCalledWith("plugin:kefrens");
    expect(mountView).toHaveBeenCalledWith("plugin:backrooms");
    expect(mountView).not.toHaveBeenCalledWith("plugin:kefrens");
  });

  it("E: reload restores Backrooms on the focused slot when mode and tiles diverged", () => {
    const tiles = ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"];
    localStorage.setItem("zoto-viz.mode", "plugin:backrooms");
    localStorage.setItem("zoto-viz.mosaicFocus", "plugin:kefrens");
    const bootMode = resolveRestoredViewMode({
      localMode: localStorage.getItem("zoto-viz.mode"),
      fallback: "plugin:topology",
    });
    const restoredTiles = reconcileMosaicTilesWithMode(
      tiles,
      bootMode,
      localStorage.getItem("zoto-viz.mosaicFocus"),
    );
    expect(restoredTiles[2]).toBe("plugin:backrooms");
    expect(restoredTiles).not.toContain("plugin:kefrens");

    const mosaic = makeLiveMosaic(restoredTiles, bootMode);
    expect(mosaic.tileIds[2]).toBe("plugin:backrooms");
    expect(mosaic.focusedId).toBe("plugin:backrooms");
  });

  it("pane picker delegates through the live hook and persists layout", async () => {
    const pick = vi.fn(async () => true);
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-reload", onChange: () => {} });
    s.onMosaicPanePick = pick;
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...DEFAULT_DREAM,
      mosaic: "4",
      mosaicTiles: ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    expect(sel).toBeTruthy();
    sel!.value = "plugin:backrooms";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pick).toHaveBeenCalledWith("plugin:topology", "plugin:backrooms");
  });
});