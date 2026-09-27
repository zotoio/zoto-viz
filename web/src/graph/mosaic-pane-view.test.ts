import { describe, expect, it } from "vitest";
import { assignTiles, defaultTree, leafIds, nextPaneTiles, placePaneTileView } from "./mosaic-layout";

describe("mosaic pane view assignment", () => {
  it("apply assignViews tile list replaces one leaf id", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = placePaneTileView(leafIds(tree!), "plugin:topology", "plugin:talkers");
    expect(next).toEqual(["plugin:talkers", "plugin:wifi"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(next);
  });

  it("duplicate-on-wall allocates a second slot for the same pack view", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = nextPaneTiles(leafIds(tree!), "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:topology", "plugin:topology!1"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(["plugin:topology", "plugin:topology!1"]);
  });

  it("a pane pick of a view not on the wall is a load, not only a swap", () => {
    const prev = ["plugin:topology", "plugin:wifi"];
    const next = nextPaneTiles(prev, "plugin:topology", "plugin:talkers");
    expect(next.filter((id) => !prev.includes(id))).toEqual(["plugin:talkers"]);
  });

  it("duplicate pack views keep distinct tile slots", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = placePaneTileView(leafIds(tree!), "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:topology", "plugin:topology!1"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(["plugin:topology", "plugin:topology!1"]);
  });
});
