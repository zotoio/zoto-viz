import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM, NetScene } from "./scene";
import { Mosaic } from "./mosaic";
import { themeById } from "../core/themes";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";

describe("Mosaic > syncPanes", () => {
  it("keeps the same pane element when a tile id stays on the wall across assignViews", () => {
    setPluginModes([
      compilePlugin({ id: "topology", name: "Topology", version: 1, engine: "graph", base: "topology" }),
      compilePlugin({ id: "memory", name: "Memory", version: 1, engine: "graph", base: "memory" }),
    ]);
    const wall = document.createElement("div");
    const sceneEl = document.createElement("div");
    document.body.append(wall, sceneEl);
    const scene = {
      currentMode: { id: "plugin:topology" },
      currentTheme: themeById("midnight"),
      currentFilters: {
        lan: true,
        internet: true,
        multicast: true,
        offline: true,
        labels: true,
        cpuIdle: true,
      },
      setAnim: () => {},
      setCompactLabels: () => {},
      relayout: () => {},
      setMode: () => {},
      setPackCoalesce: () => {},
      dreamAnim: DEFAULT_DREAM,
      pluginSkyId: null,
    } as unknown as NetScene;
    const anim = {
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:memory"],
      mosaicTree: null,
      mosaicMaxId: "",
    };
    const mosaic = new Mosaic({
      wall,
      sceneEl,
      main: scene,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onCloseLast: () => {},
      onLayout: () => {},
      sync: () => ({
        theme: scene.currentTheme,
        filters: scene.currentFilters,
        anim,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("2", "plugin:topology", "off", { tree: null, maximized: null, tiles: anim.mosaicTiles });
    const pane = wall.querySelector<HTMLElement>('[data-mode="plugin:topology"]');
    expect(pane).toBeTruthy();
    mosaic.assignViews(["plugin:memory", "plugin:topology"]);
    const paneAfter = wall.querySelector<HTMLElement>('[data-mode="plugin:topology"]');
    expect(paneAfter).toBe(pane);
    wall.remove();
    sceneEl.remove();
  });
});
