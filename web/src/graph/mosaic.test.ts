import { afterEach, describe, expect, it } from "vitest";
import { mosaicIds } from "./mosaic";
import { setPluginModes, topology } from "../core/modes";

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
