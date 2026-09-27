import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignMosaicSkies,
  assignParsedMosaicTree,
  mosaicAnimForTile,
  mosaicIds,
  mosaicIsGraph,
  mosaicPaneMode,
  mosaicShouldLift,
  mosaicTileTheme,
  pinPluginTileSkies,
  shouldUniqueMosaicSkies,
} from "./mosaic";
import { applyPluginCatalog } from "../plugins/plugin";
import { defaultTree, leafIds } from "./mosaic-layout";
import { mosaicTileViewId } from "./mosaic-tile-id";
import * as plugin from "../plugins/plugin";
import { memory, setPluginModes, topology } from "../core/modes";
import { themeById } from "../core/themes";
import { DEFAULT_DREAM } from "./scene";

afterEach(() => {
  setPluginModes([]);
  applyPluginCatalog([]);
});

describe("mosaicIds", () => {
  it("is empty when the catalog has not loaded yet", () => {
    expect(mosaicIds("4")).toEqual([]);
    expect(mosaicIds("6", "plugin:topology")).toEqual([]);
  });

  it("takes the first n catalog rows", () => {
    setPluginModes(["a", "b", "c", "d"].map((id) => ({
      ...topology,
      id: `plugin:${id}`,
      pluginId: id,
      label: id,
    })));
    expect(mosaicIds("4")).toEqual(["plugin:a", "plugin:b", "plugin:c", "plugin:d"]);
  });
});

describe("mosaic boot primary pack tile", () => {
  const packMode = (pluginId: string) => ({
    ...topology,
    id: `plugin:${pluginId}`,
    pluginId,
    label: pluginId,
    family: "viz-pack" as const,
  });

  it("boot with 4 packs: primary tile shows the primary pack id exactly", () => {
    setPluginModes([
      packMode("pack-a"),
      packMode("pack-b"),
      packMode("pack-c"),
      packMode("pack-d"),
      packMode("pack-e"),
    ]);
    const primary = "plugin:pack-c";
    const staleTree = defaultTree(
      ["plugin:pack-a", "plugin:pack-b", "plugin:pack-d", "plugin:pack-e"],
      "off",
    )!;
    expect(mosaicTileViewId(leafIds(staleTree)[0]!)).not.toBe(primary);
    const tree = assignParsedMosaicTree(staleTree, "4", primary, "off", []);
    expect(mosaicTileViewId(leafIds(tree)[0]!)).toBe(primary);
  });
});

describe("mosaicPaneMode", () => {
  it("uses the host engine when the catalog is empty so SYS tiles still graph", () => {
    expect(mosaicIsGraph("plugin:memory")).toBe(true);
    expect(mosaicPaneMode("plugin:memory").graphBase).toBe("memory");
    expect(mosaicPaneMode("plugin:cores").graphBase).toBe("cpu");
    expect(mosaicIsGraph("plugin:pacman")).toBe(false);
  });

  it("prefers the compiled catalog row when present", () => {
    setPluginModes([{ ...memory, id: "plugin:memory", pluginId: "memory", label: "Mem wrap" }]);
    expect(mosaicPaneMode("plugin:memory").id).toBe("plugin:memory");
    expect(mosaicPaneMode("plugin:memory").label).toBe("Mem wrap");
  });

  it("resolves a duplicate tile slot to the same catalog mode", () => {
    setPluginModes([{ ...memory, id: "plugin:memory", pluginId: "memory", label: "Mem wrap" }]);
    expect(mosaicPaneMode("plugin:memory!2").id).toBe("plugin:memory");
  });
});

describe("mosaicShouldLift", () => {
  it("picks up from chrome or alt immediately", () => {
    expect(mosaicShouldLift("chrome", null, "a")).toBe(true);
    expect(mosaicShouldLift("alt", "a", "a")).toBe(true);
  });

  it("picks up a body drag only once the pointer is over another tile", () => {
    expect(mosaicShouldLift("body", null, "a")).toBe(false);
    expect(mosaicShouldLift("body", "a", "a")).toBe(false);
    expect(mosaicShouldLift("body", "b", "a")).toBe(true);
  });
});

describe("mosaic unique skies", () => {
  it("is unique on a low roll and shared on a high roll", () => {
    expect(shouldUniqueMosaicSkies(() => 0)).toBe(true);
    expect(shouldUniqueMosaicSkies(() => 0.49)).toBe(true);
    expect(shouldUniqueMosaicSkies(() => 0.5)).toBe(false);
  });

  it("gives every pane a different host sky and keeps plugin shaders", () => {
    const skies = assignMosaicSkies(
      ["plugin:a", "plugin:b", "plugin:c", "plugin:d"],
      "aurora",
      ["aurora", "space", "fire", "ocean", "matrix"],
      (id) => id === "plugin:b" ? "plugin" : undefined,
    );
    expect(skies["plugin:b"]).toBe("plugin");
    const host = ["plugin:a", "plugin:c", "plugin:d"].map((id) => skies[id]);
    expect(new Set(host).size).toBe(3);
    expect(host.includes("aurora")).toBe(false);
  });

  it("merges catalog look via pack view id when tile slot has a suffix", () => {
    const lookSpy = vi.spyOn(plugin, "lookForMode").mockImplementation((id) =>
      (id === "plugin:pulse" ? { backdrop: "matrix" as const } : undefined));
    const wall = { ...DEFAULT_DREAM, backdrop: "aurora" as const };
    expect(mosaicAnimForTile(wall, "plugin:pulse!2", undefined).backdrop).toBe("matrix");
    expect(lookSpy).toHaveBeenCalledWith("plugin:pulse");
    lookSpy.mockRestore();
  });

  it("overrides a host wall sky per tile and keeps plugin shaders", () => {
    const wall = { ...DEFAULT_DREAM, backdrop: "aurora" as const };
    expect(mosaicAnimForTile(wall, "plugin:talkers", "fire").backdrop).toBe("fire");
    expect(mosaicAnimForTile({ ...wall, backdrop: "plugin" as const }, "plugin:talkers", "plugin").backdrop).toBe("plugin");
    expect(mosaicAnimForTile({ ...wall, backdrop: "plugin" as const }, "plugin:talkers", "fire").backdrop).toBe("fire");
  });

  it("keeps unlisted tile skies when the unique-sky plan is partial", () => {
    const seeded = {
      "plugin:a": "fire" as const,
      "plugin:b": "space" as const,
      "plugin:c": "aurora" as const,
    };
    expect(pinPluginTileSkies(
      { "plugin:a": "matrix" },
      ["plugin:a", "plugin:b", "plugin:c"],
      seeded,
    )).toStrictEqual({
      "plugin:a": "matrix",
      "plugin:b": "space",
      "plugin:c": "aurora",
    });
  });

  it("drops undefined mosaic sky entries and still pins plugin looks", () => {
    applyPluginCatalog([{
      id: "backrooms",
      name: "Backrooms",
      version: 1,
      engine: "graph",
      look: { backdrop: "plugin", mosaic: "off", stageOnly: true },
    }]);
    expect(pinPluginTileSkies(
      {
        "plugin:backrooms": undefined,
        "plugin:air-ssid": "space",
        "plugin:memory": undefined,
      },
      ["plugin:backrooms", "plugin:air-ssid", "plugin:memory"],
    )).toStrictEqual({
      "plugin:backrooms": "plugin",
      "plugin:air-ssid": "space",
    });
  });

  it("keeps a plugin-sky look even when a unique-sky plan named a host sky", () => {
    applyPluginCatalog([{
      id: "backrooms",
      name: "Backrooms",
      version: 1,
      engine: "graph",
      look: { backdrop: "plugin", mosaic: "off", stageOnly: true },
    }]);
    const planned = pinPluginTileSkies(
      { "plugin:backrooms": "matrix", "plugin:air-ssid": "space" },
      ["plugin:backrooms", "plugin:air-ssid"],
    );
    expect(planned["plugin:backrooms"]).toBe("plugin");
    expect(planned["plugin:air-ssid"]).toBe("space");
    const wall = { ...DEFAULT_DREAM, backdrop: "tornado" as const };
    expect(mosaicAnimForTile(wall, "plugin:backrooms", "matrix").backdrop).toBe("plugin");
  });
});

describe("mosaicTileTheme", () => {
  it("reuses the wall palette when one theme is on", () => {
    const wall = themeById("midnight");
    const used = new Set([wall.id]);
    expect(mosaicTileTheme(true, wall, used, "ocean").id).toBe("midnight");
    expect(used.size).toBe(1);
  });

  it("takes an unused palette when tiles keep their own", () => {
    const wall = themeById("midnight");
    const used = new Set([wall.id]);
    expect(mosaicTileTheme(false, wall, used, "ocean").id).toBe("ocean");
    expect(used.has("ocean")).toBe(true);
  });
});
