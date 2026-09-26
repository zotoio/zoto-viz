import { afterEach, describe, expect, it } from "vitest";
import { topology } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";
import { Mosaic } from "./mosaic";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";
import { setPluginModes } from "../core/modes";
import { nextPaneTiles, mosaicPaneIdsWithViewChange } from "./mosaic-layout";

function countMap(): Map<string, number> {
  return new Map();
}

function bump(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}

function pluginWallAnim(ids: string[]) {
  const mosaicSkies = Object.fromEntries(ids.map((id) => [id, "plugin" as const]));
  return {
    ...DEFAULT_DREAM,
    mosaicUniqueSkies: true as const,
    mosaicSkies,
  };
}

describe("assignViews selective sky hold", () => {
  afterEach(() => setPluginModes([]));

  function mosaic2x2() {
    const ids = ["plugin:a", "plugin:b", "plugin:c", "plugin:d"] as const;
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
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel(ids[0]);

    const skyHold = countMap();
    const modeRefresh = countMap();
    const auditBind = countMap();
    const rebind = countMap();

    const wallAnim = { ...pluginWallAnim([...ids]) };
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
        anim: wallAnim,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
      testHooks: {
        onSkyHold: (id) => bump(skyHold, id),
        onModeRefresh: (id) => bump(modeRefresh, id),
        onPaneAuditBind: (id) => bump(auditBind, id),
        onPaneRebind: (id) => bump(rebind, id),
      },
    });

    mosaic.setSize("4", ids[0], "off", { tiles: [...ids] });
    mosaic.settlePanes();
    skyHold.clear();
    modeRefresh.clear();
    auditBind.clear();
    rebind.clear();

    return { mosaic, ids, skyHold, modeRefresh, auditBind, rebind, host, main, wall, wallAnim };
  }

  function expectQuiet(
    ids: readonly string[],
    maps: Map<string, number>[],
    except: readonly string[] = [],
  ): void {
    const skip = new Set(except);
    for (const id of ids) {
      if (skip.has(id)) continue;
      for (const map of maps) expect(map.get(id) ?? 0, id).toBe(0);
    }
  }

  it("changing one tile on a 2×2 plugin-sky wall does not restart neighbours", () => {
    const { mosaic, ids, skyHold, modeRefresh, auditBind, rebind, wallAnim, host, main, wall } = mosaic2x2();
    const [a, b, c, d] = ids;
    const prev = [...mosaic.tileIds];
    const next = nextPaneTiles(prev, a, "plugin:x");
    expect(mosaicPaneIdsWithViewChange(prev, next).sort()).toEqual(["plugin:a", "plugin:x"]);
    setPluginModes([
      ...ids.map((id) => ({ ...topology, id, pluginId: id.slice(7), label: id })),
      { ...topology, id: "plugin:x", pluginId: "x", label: "x" },
    ]);
    Object.assign(wallAnim, pluginWallAnim([...ids, "plugin:x"]));
    expect(mosaic.setPaneView(a, "plugin:x")).toBe(true);

    expectQuiet([b, c, d], [skyHold, modeRefresh, auditBind, rebind]);
    expect((modeRefresh.get("plugin:x") ?? 0) + (rebind.get("plugin:x") ?? 0)).toBeGreaterThan(0);
    host.dispose();
    main.dispose();
    wall.remove();
  });

  it("swap-on-wall touches only the two swapped plugin-sky tiles", () => {
    const { mosaic, ids, skyHold, modeRefresh, auditBind, rebind, host, main, wall } = mosaic2x2();
    const [a, b, c, d] = ids;
    expect(mosaic.setPaneView(a, b)).toBe(true);

    expectQuiet([c, d], [skyHold, modeRefresh, auditBind, rebind]);
    expect((modeRefresh.get(a) ?? 0) + (modeRefresh.get(b) ?? 0)).toBeGreaterThan(0);
    expect((rebind.get(a) ?? 0) + (rebind.get(b) ?? 0)).toBeGreaterThan(0);
    host.dispose();
    main.dispose();
    wall.remove();
  });
});
