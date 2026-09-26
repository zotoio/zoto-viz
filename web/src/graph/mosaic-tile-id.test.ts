import { describe, expect, it } from "vitest";
import { mosaicTileViewId } from "./mosaic-tile-id";

describe("mosaicTileViewId", () => {
  it("strips only an all-digit !<n> slot suffix", () => {
    expect(mosaicTileViewId("plugin:foo!2")).toBe("plugin:foo");
  });

  it("leaves non-slot bang tails unchanged", () => {
    expect(mosaicTileViewId("plugin:foo!bar")).toBe("plugin:foo!bar");
  });
});
