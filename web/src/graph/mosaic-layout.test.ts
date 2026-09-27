import { describe, expect, it } from "vitest";
import {
  assignTiles, centerSplit, closeLeaf, defaultTree, equalize, gridTree, leafIds, mosaicPaneIdsWithViewChange,
  nextPaneTiles, parseMosaicNode, parseMosaicTiles, setRatio, structureKey, swapLeaves,
  assignTiles, centerSplit, closeLeaf, defaultTree, equalize, gridTree, leafIds,
  nextPaneTiles,
  placePaneTileView,
  parseMosaicNode, parseMosaicTiles, setRatio, structureKey, swapLeaves,
} from "./mosaic-layout";

describe("grid / default trees", () => {
  it("builds a 2×2 then a 2×3", () => {
    const four = gridTree(["a", "b", "c", "d"], 2);
    expect(leafIds(four)).toEqual(["a", "b", "c", "d"]);
    expect(four.type).toBe("split");
    const six = defaultTree(["a", "b", "c", "d", "e", "f"], "off");
    expect(leafIds(six)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("puts a left hero beside the leftover tiles", () => {
    const t = defaultTree(["hero", "a", "b", "c", "d"], "left");
    expect(t?.type).toBe("split");
    if (t?.type !== "split") return;
    expect(t.dir).toBe("h");
    expect(t.a).toEqual({ type: "leaf", id: "hero" });
    expect(leafIds(t.b)).toEqual(["a", "b", "c", "d"]);
  });

  it("splits a center hero 4+2 for six leftover tiles", () => {
    expect(centerSplit(6)).toEqual([4, 2]);
    const ids = ["hero", "a", "b", "c", "d", "e", "f"];
    const t = defaultTree(ids, "center");
    expect(leafIds(t)).toEqual(["a", "b", "c", "d", "hero", "e", "f"]);
    expect(leafIds(t)).toHaveLength(7);
    expect(leafIds(t)).toContain("hero");
  });
});

describe("close / swap / assign", () => {
  it("expands the neighbour when a leaf closes", () => {
    const t = gridTree(["a", "b", "c", "d"], 2);
    const next = closeLeaf(t, "b");
    expect(leafIds(next)).toEqual(["a", "c", "d"]);
    expect(next && structureKey(next).includes("b")).toBe(false);
  });

  it("returns null when the last leaf closes", () => {
    expect(closeLeaf({ type: "leaf", id: "only" }, "only")).toBeNull();
  });

  it("swaps two leaves without changing the split", () => {
    const t = gridTree(["a", "b", "c", "d"], 2);
    const key = structureKey(t).replace(/L:a/g, "L:x").replace(/L:c/g, "L:a").replace(/L:x/g, "L:c");
    const swapped = swapLeaves(t, "a", "c");
    expect(leafIds(swapped)).toEqual(["c", "b", "a", "d"]);
    expect(structureKey(swapped)).toBe(key);
  });

  it("assigns tile ids in order and skips duplicates", () => {
    const t = gridTree(["a", "b", "c", "d"], 2);
    expect(leafIds(assignTiles(t, ["x", "x", "y"]))).toEqual(["x", "y", "a", "b"]);
    expect(parseMosaicTiles(["a", "", "a", "b", 1])).toEqual(["a", "b"]);
  });

  it("replaces one pane and allocates a duplicate slot when the target is already on the wall", () => {
    expect(nextPaneTiles(["a", "b", "c"], "b", "x")).toEqual(["a", "x", "c"]);
    expect(nextPaneTiles(["a", "b", "c"], "a", "c")).toEqual(["c!1", "b", "c"]);
    expect(nextPaneTiles(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(nextPaneTiles(["a", "b"], "z", "x")).toEqual(["a", "b"]);
  });

  it("mosaicPaneIdsWithViewChange lists replaced and swapped panes only", () => {
    expect(mosaicPaneIdsWithViewChange(["a", "b", "c", "d"], ["x", "b", "c", "d"]).sort()).toEqual(["a", "x"]);
    expect(mosaicPaneIdsWithViewChange(["a", "b", "c", "d"], ["b", "a", "c", "d"]).sort()).toEqual(["a", "b"]);
    expect(mosaicPaneIdsWithViewChange(["a", "b"], ["a", "b"]).sort()).toEqual([]);
  it("nextPaneTiles allocates a new slot when picking another tile of the same pack view", () => {
    expect(nextPaneTiles(["plugin:x", "b", "c"], "b", "plugin:x")).toEqual(["plugin:x", "plugin:x!1", "c"]);
  });
});

describe("ratios / parse", () => {
  it("clamps a split ratio and equalizes the tree", () => {
    const t = gridTree(["a", "b"], 2);
    const wide = setRatio(t, "", 0.95);
    expect(wide.type === "split" && wide.ratio).toBe(0.88);
    const eq = equalize(setRatio(t, "", 0.2));
    expect(eq.type === "split" && eq.ratio).toBe(0.5);
  });

  it("round-trips a stored tree and rejects junk", () => {
    const t = defaultTree(["a", "b", "c", "d"], "left");
    expect(parseMosaicNode(t)).toEqual(t);
    expect(parseMosaicNode({ type: "leaf" })).toBeNull();
    expect(parseMosaicNode({ type: "split", dir: "h", ratio: 0.4, a: { type: "leaf", id: "a" } })).toBeNull();
  });
});
