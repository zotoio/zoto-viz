import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { topology, setPluginModes } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";
import { Mosaic } from "./mosaic";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";
import { nextPaneTiles, mosaicPaneIdsWithViewChange } from "./mosaic-layout";

describe("assignViews selective sky hold", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => setPluginModes([]));

  it("changing one tile on a 2×2 wall lists only the replaced slot in mosaicPaneIdsWithViewChange", () => {
    const ids = ["plugin:a", "plugin:b", "plugin:c", "plugin:d"];
    setPluginModes(ids.map((id) => ({
      ...topology,
      id,
      pluginId: id.slice("plugin:".length),
      label: id,
    })));
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel(ids[0]);
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
        anim: DEFAULT_DREAM,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("4", ids[0], "off", { tiles: ids });
    const prev = [...mosaic.tileIds];
    const next = nextPaneTiles(prev, "plugin:a", "plugin:x");
    expect(mosaicPaneIdsWithViewChange(prev, next).sort()).toEqual(["plugin:a", "plugin:x"]);
    setPluginModes([
      ...ids.map((id) => ({ ...topology, id, pluginId: id.slice(7), label: id })),
      { ...topology, id: "plugin:x", pluginId: "x", label: "x" },
    ]);
    expect(mosaic.setPaneView("plugin:a", "plugin:x")).toBe(true);
    host.dispose();
    main.dispose();
  });

  it("swap-on-wall lists exactly the two swapped panes", () => {
    const ids = ["plugin:a", "plugin:b", "plugin:c", "plugin:d"];
    setPluginModes(ids.map((id) => ({
      ...topology,
      id,
      pluginId: id.slice("plugin:".length),
      label: id,
    })));
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
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
        anim: DEFAULT_DREAM,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("4", ids[0], "off", { tiles: ids });
    const prev = [...mosaic.tileIds];
    const next = nextPaneTiles(prev, "plugin:a", "plugin:b");
    expect(mosaicPaneIdsWithViewChange(prev, next).sort()).toEqual(["plugin:a", "plugin:b"]);
    expect(mosaic.setPaneView("plugin:a", "plugin:b")).toBe(true);
    host.dispose();
    main.dispose();
  });
});
