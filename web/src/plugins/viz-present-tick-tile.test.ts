import { describe, expect, it } from "vitest";
import { presentTickTileId } from "./viz-present-tick";

describe("presentTickTileId", () => {
  it("uses the pack id and ignores mosaic focus / mode slug", () => {
    expect(presentTickTileId("backrooms")).toBe("backrooms");
    expect(presentTickTileId("backrooms")).not.toBe("plugin:topology");
    expect(presentTickTileId(undefined)).toBe("");
  });
});
