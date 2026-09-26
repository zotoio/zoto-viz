import { describe, expect, it } from "vitest";
import {
  allocateMosaicTileSlot,
  mosaicPlacedTileIndices,
  mosaicTileSlotId,
  mosaicTileViewId,
  mosaicWallUsesView,
  parseMosaicSlotId,
} from "./mosaic-tile-id";
import { configStoreId } from "../plugins/instances";
import { parsePluginId } from "../plugins/instances";

describe("mosaic tile slot ids", () => {
  it("round-trips pack view ids and allocates duplicate slots", () => {
    expect(mosaicTileViewId("plugin:topology")).toBe("plugin:topology");
    expect(mosaicTileViewId("plugin:topology!2")).toBe("plugin:topology");
    expect(mosaicTileSlotId("plugin:topology", 2)).toBe("plugin:topology!2");
    expect(allocateMosaicTileSlot("plugin:topology", ["plugin:topology"])).toBe("plugin:topology!1");
    expect(allocateMosaicTileSlot("plugin:topology", ["plugin:topology", "plugin:topology!1"])).toBe("plugin:topology!2");
  });

  it("marks placed views by tile index", () => {
    const tiles = ["plugin:a", "plugin:b", "plugin:a!1"];
    expect(mosaicPlacedTileIndices(tiles, "plugin:a")).toEqual([1, 3]);
    expect(mosaicWallUsesView(tiles, "plugin:b")).toBe(true);
  });

  it("parseMosaicSlotId splits pack and numeric slot", () => {
    expect(parseMosaicSlotId("plugin:air-bt!1")).toEqual({
      packId: "air-bt",
      slot: 1,
      viewId: "plugin:air-bt",
    });
    expect(parseMosaicSlotId("plugin:topology")).toEqual({
      packId: "topology",
      slot: null,
      viewId: "plugin:topology",
    });
  });

  it("keeps one config store id for two tiles of the same pack", () => {
    const packId = parsePluginId("plugin:air-bt")!;
    const a = configStoreId({ id: packId });
    const b = configStoreId({ id: parsePluginId("plugin:air-bt!1")! });
    expect(a).toBe("air-bt");
    expect(b).toBe("air-bt");
  });
});
