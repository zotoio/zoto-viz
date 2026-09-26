import { describe, expect, it } from "vitest";
import { assignTiles, defaultTree, leafIds, nextPaneTiles } from "./mosaic-layout";

describe("mosaic pane view assignment", () => {
  it("apply assignViews tile list replaces one leaf id", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = nextPaneTiles(leafIds(tree!), "plugin:topology", "plugin:talkers");
    expect(next).toEqual(["plugin:talkers", "plugin:wifi"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(next);
  });

  it("duplicate-on-wall adds a slot id instead of swapping", () => {
    const tree = defaultTree(["plugin:topology", "plugin:wifi"], "off");
    const next = nextPaneTiles(leafIds(tree!), "plugin:wifi", "plugin:topology");
    expect(next).toEqual(["plugin:topology", "plugin:topology!1"]);
    const assigned = assignTiles(tree!, next);
    expect(leafIds(assigned)).toEqual(["plugin:topology", "plugin:topology!1"]);
  });
});
