import { afterEach, describe, expect, it } from "vitest";
import { mosaicIds, mosaicIsGraph, mosaicPaneMode, mosaicTileTheme } from "./mosaic";
import { memory, setPluginModes, topology } from "../core/modes";
import { themeById } from "../core/themes";

afterEach(() => setPluginModes([]));

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
