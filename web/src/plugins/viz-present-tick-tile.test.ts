import { describe, expect, it } from "vitest";
import { presentTickTileId } from "./viz-present-tick";

describe("presentTickTileId", () => {
  it("uses the catalog pack id (not instance or mosaic slot)", () => {
    expect(presentTickTileId("backrooms")).toBe("backrooms");
    expect(presentTickTileId("backrooms")).not.toBe("plugin:topology");
    expect(presentTickTileId(undefined)).toBe("");
  });
});
