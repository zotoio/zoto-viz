import { describe, expect, it } from "vitest";
import { assignTiles, defaultTree, leafIds, nextPaneTiles, parseMosaicTiles, placedPaneSlot, type MosaicNode } from "./mosaic-layout";
import { mosaicViewsUnique, uniqueMosaicViews } from "./mosaic-tile-id";

const POOL = ["plugin:voxel-world", "plugin:topology", "plugin:aquarium", "plugin:backrooms", "plugin:fractal-zoom", "plugin:botz-wire", "plugin:air-bt"];

/** The live wall Andrew hit: botz-wire twice via `!3` / `!1`. */
const LIVE: MosaicNode = {
  type: "split", dir: "h", ratio: 0.6875,
  a: { type: "leaf", id: "plugin:voxel-world" },
  b: {
    type: "split", dir: "v", ratio: 0.66,
    a: {
      type: "split", dir: "v", ratio: 0.5,
      a: { type: "split", dir: "h", ratio: 0.5, a: { type: "leaf", id: "plugin:fractal-zoom" }, b: { type: "leaf", id: "plugin:topology" } },
      b: { type: "split", dir: "h", ratio: 0.5, a: { type: "leaf", id: "plugin:aquarium" }, b: { type: "leaf", id: "plugin:backrooms" } },
    },
    b: { type: "split", dir: "h", ratio: 0.5, a: { type: "leaf", id: "plugin:botz-wire!3" }, b: { type: "leaf", id: "plugin:botz-wire!1" } },
  },
};
const LIVE_TILES = ["plugin:voxel-world", "plugin:fractal-zoom", "plugin:topology", "plugin:aquarium", "plugin:backrooms", "plugin:botz-wire!3", "plugin:botz-wire!1"];

describe("mosaic: a view is on at most one pane", () => {
  it("uniqueMosaicViews strips !n and refills repeats from unused pool views", () => {
    expect(uniqueMosaicViews(["a!2", "b", "a", "a!1"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
    expect(uniqueMosaicViews(["a", "a"], ["a"])).toEqual(["a", null]);
  });

  it("restoring the saved live wall removes the duplicate and the suffixes", () => {
    const tree = assignTiles(LIVE, LIVE_TILES, POOL);
    const ids = leafIds(tree);
    expect(ids).toHaveLength(7);
    expect(mosaicViewsUnique(ids)).toBe(true);
    expect(ids.some((id) => id.includes("!"))).toBe(false);
    expect(ids).toContain("plugin:botz-wire");
    expect(ids[6]).toBe("plugin:air-bt");
  });

  it("closes a repeat when no unused view is left", () => {
    const tree = assignTiles(LIVE, LIVE_TILES, []);
    expect(leafIds(tree)).toEqual(["plugin:voxel-world", "plugin:fractal-zoom", "plugin:topology", "plugin:aquarium", "plugin:backrooms", "plugin:botz-wire"]);
  });

  it("parseMosaicTiles normalises suffixes and drops repeats", () => {
    expect(parseMosaicTiles(["x!3", "y", "x!1", "x"])).toEqual(["x", "y"]);
  });

  it("defaultTree never builds a wall with a view twice", () => {
    expect(mosaicViewsUnique(leafIds(defaultTree(["a", "a!1", "b"], "left")))).toBe(true);
  });

  it("picking a view already on another pane swaps the two panes", () => {
    const ids = ["main", "aq", "botz"];
    expect(nextPaneTiles(ids, "aq", "botz")).toEqual(["main", "botz", "aq"]);
    expect(placedPaneSlot(ids, "aq", "botz")).toBe("botz");
  });

  it("swapping the main pane to the aquarium and back leaves no !n slot (the botz-wire!2 repro)", () => {
    let ids = ["plugin:botz-wire", "plugin:aquarium", "plugin:topology"];
    ids = nextPaneTiles(ids, "plugin:botz-wire", "plugin:aquarium");
    expect(ids).toEqual(["plugin:aquarium", "plugin:botz-wire", "plugin:topology"]);
    ids = nextPaneTiles(ids, "plugin:aquarium", "plugin:botz-wire");
    expect(ids).toEqual(["plugin:botz-wire", "plugin:aquarium", "plugin:topology"]);
  });

  it("a legacy !n pane picking its own view normalises instead of failing", () => {
    expect(nextPaneTiles(["a", "botz!1"], "botz!1", "botz")).toEqual(["a", "botz"]);
  });

  it("random fill: 500 random picks never produce a duplicate", () => {
    let ids = POOL.slice(0, 5);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 500; k++) {
      const from = ids[Math.floor(rnd() * ids.length)]!;
      const to = POOL[Math.floor(rnd() * POOL.length)]!;
      ids = nextPaneTiles(ids, from, to);
      expect(mosaicViewsUnique(ids)).toBe(true);
    }
  });
});

describe("mosaic: canonical view identity", () => {
  it("ids that alias to one view (registered keys, e.g. same caption / pack instance) count as duplicates", async () => {
    const { setMosaicViewKeys } = await import("./mosaic-tile-id");
    setMosaicViewKeys((v) => (v === "plugin:botz-wire" || v === "plugin:botz-wire:botz-wire" ? ["cap:src botz wire"] : []));
    try {
      expect(uniqueMosaicViews(["plugin:botz-wire", "plugin:botz-wire:botz-wire!2", "plugin:topology"], ["plugin:botz-wire", "plugin:air-bt"]))
        .toEqual(["plugin:botz-wire", "plugin:air-bt", "plugin:topology"]);
      expect(mosaicViewsUnique(["plugin:botz-wire:botz-wire", "plugin:botz-wire"])).toBe(false);
    } finally {
      setMosaicViewKeys(() => []);
    }
  });

  it("never mints a !n copy", async () => {
    const { allocateMosaicTileSlot } = await import("./mosaic-tile-id");
    expect(allocateMosaicTileSlot("plugin:botz-wire", ["plugin:botz-wire", "plugin:botz-wire!1"])).toBe("plugin:botz-wire");
  });
});
