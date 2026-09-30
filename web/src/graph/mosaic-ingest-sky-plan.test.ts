import { afterEach, describe, expect, it } from "vitest";
import { topology, setPluginModes } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM, type DreamAnim } from "./scene";
import type { BackdropKind } from "./backdrop";
import { applyPluginCatalog } from "../plugins/plugin";
import { Mosaic } from "./mosaic";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";

function mosaicWall(ids: readonly string[]) {
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
  main.retargetPanel(ids[0]!);

  const skies: BackdropKind[] = ["fire", "space", "aurora", "ocean"];
  let anim: DreamAnim = {
    ...DEFAULT_DREAM,
    mosaicUniqueSkies: true as const,
    mosaicSkies: Object.fromEntries(ids.map((id, i) => [id, skies[i]!])),
  };

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
      anim,
      dreaming: false,
      nodeFilter: () => true,
      lastMsg: null,
      aliasMap: new Map(),
    }),
  });

  mosaic.setSize("4", ids[0], "off", { tiles: [...ids] });

  return {
    mosaic,
    host,
    setAnim(patch: typeof anim) {
      anim = patch;
    },
    applyAnim(patch: Partial<typeof anim>, pin = true) {
      Object.assign(anim, patch);
      mosaic.applyLooks(anim, pin);
    },
  };
}

describe("Mosaic.ingestSkyPlan via applyLooks", () => {
  afterEach(() => setPluginModes([]));

  it("keeps unlisted tile skies on a partial unique-sky plan and never stores undefined", () => {
    const ids = ["plugin:a", "plugin:b", "plugin:c"] as const;
    const { mosaic, host, applyAnim } = mosaicWall(ids);

    expect(mosaic.paneSky("plugin:a")).toBe("fire");
    expect(mosaic.paneSky("plugin:b")).toBe("space");
    expect(mosaic.paneSky("plugin:c")).toBe("aurora");

    applyAnim({
      mosaicSkies: { "plugin:a": "matrix", "plugin:c": undefined },
    });

    expect(mosaic.paneSky("plugin:a")).toBe("matrix");
    expect(mosaic.paneSky("plugin:b")).toBe("space");
    expect(mosaic.paneSky("plugin:c")).toBe("aurora");

    const skies = mosaic.layout.skies ?? {};
    for (const id of ids) expect(skies[id]).toBeDefined();
    expect(Object.values(skies).every((sky) => sky !== undefined)).toBe(true);

    host.dispose();
  });

  it("keeps a plugin stage on its own sky when the wall look is not pinned", () => {
    applyPluginCatalog([{
      id: "aquarium",
      name: "Aquarium",
      version: 1,
      engine: "graph",
      look: { backdrop: "plugin", stageOnly: true, mosaic: "off" },
    }]);
    const ids = ["plugin:a", "plugin:b", "plugin:aquarium"] as const;
    const { mosaic, host, applyAnim } = mosaicWall(ids);

    expect(mosaic.paneSky("plugin:aquarium")).toBe("plugin");
    expect(mosaic.graphScene("plugin:aquarium")?.dreamAnim.backdrop).toBe("plugin");

    applyAnim({ backdrop: "lagoon" }, false);

    expect(mosaic.paneSky("plugin:aquarium")).toBe("plugin");
    expect(mosaic.graphScene("plugin:aquarium")?.dreamAnim.backdrop).toBe("plugin");
    expect(mosaic.paneSky("plugin:a")).not.toBe("lagoon");
    expect(mosaic.paneSky("plugin:b")).not.toBe("lagoon");
    expect(mosaic.graphScene("plugin:a")?.dreamAnim.backdrop).not.toBe("lagoon");

    host.dispose();
  });

  it("shares the wall sky on panes that do not author one", () => {
    applyPluginCatalog([{
      id: "aquarium",
      name: "Aquarium",
      version: 1,
      engine: "graph",
      look: { backdrop: "plugin", stageOnly: true, mosaic: "off" },
    }]);
    const ids = ["plugin:a", "plugin:b", "plugin:aquarium"] as const;
    const { mosaic, host, applyAnim } = mosaicWall(ids);

    applyAnim({
      mosaicUniqueSkies: false,
      mosaicSkies: {},
      backdrop: "lagoon",
    });

    expect(mosaic.paneSky("plugin:a")).toBeUndefined();
    expect(mosaic.graphScene("plugin:a")?.dreamAnim.backdrop).toBe("lagoon");
    expect(mosaic.graphScene("plugin:b")?.dreamAnim.backdrop).toBe("lagoon");
    expect(mosaic.graphScene("plugin:aquarium")?.dreamAnim.backdrop).toBe("plugin");

    host.dispose();
  });
});
