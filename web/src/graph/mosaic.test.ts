import { afterEach, describe, expect, it } from "vitest";
import { mosaicIds, mosaicTileTheme } from "./mosaic";
import { setPluginModes, topology } from "../core/modes";
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
