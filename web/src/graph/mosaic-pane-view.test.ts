import { describe, expect, it } from "vitest";
import {
  assignTiles,
  defaultTree,
  leafIds,
  nextPaneTiles,
  nextPaneTilesForPicker,
  placePaneTileView,
} from "./mosaic-layout";

describe("mosaic pane view assignment", () => {
  it("apply assignViews tile list replaces one leaf id", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = placePaneTileView(leafIds(tree!), "plugin:topology", "plugin:talkers");
    expect(next).toEqual(["plugin:talkers", "plugin:wifi"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(next);
  });

  it("settings picker on a view already on the wall swaps the two panes (no duplicate)", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = nextPaneTilesForPicker(leafIds(tree!), "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:wifi", "plugin:topology"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(["plugin:wifi", "plugin:topology"]);
  });

  it("wall pick of a view already on the wall swaps the panes", () => {
    const prev = ["plugin:topology", "plugin:wifi"];
    const next = nextPaneTiles(prev, "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:wifi", "plugin:topology"]);
  });

  it("a pane pick of a view not on the wall is a load, not only a swap", () => {
    const prev = ["plugin:topology", "plugin:wifi"];
    const next = nextPaneTiles(prev, "plugin:topology", "plugin:talkers");
    expect(next.filter((id) => !prev.includes(id))).toEqual(["plugin:talkers"]);
  });

  it("placing a view already on the wall swaps, never a !n copy", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = placePaneTileView(leafIds(tree!), "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:wifi", "plugin:topology"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(["plugin:wifi", "plugin:topology"]);
  });
});
