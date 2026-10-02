import { describe, expect, it } from "vitest";
import { validateWallLayoutDoc, wallLayoutMosaicError } from "./pack-wall-layout";

describe("validateWallLayoutDoc", () => {
  it("rejects unknown mosaic with exact message", () => {
    const msg = wallLayoutMosaicError("fixture tile_4x4.look", "32");
    expect(() =>
      validateWallLayoutDoc({ tile_4x4: { look: { mosaic: "32" } } }, "fixture"),
    ).toThrow(msg);
    expect(() =>
      validateWallLayoutDoc({ tile_4x4: { look: { mosaic: "16" } } }, "fixture"),
    ).not.toThrow();
  });

  it("accepts mosaic 8", () => {
    expect(() =>
      validateWallLayoutDoc({ tile_4x4: { look: { mosaic: "8" } } }, "fixture"),
    ).not.toThrow();
  });
});
