import { describe, expect, it } from "vitest";
import { validateWallLayoutDoc, wallLayoutMosaicError } from "./pack-wall-layout";

describe("validateWallLayoutDoc", () => {
  it("rejects unknown mosaic with exact message", () => {
    const msg = wallLayoutMosaicError("fixture tile_4x4.look", "16");
    expect(() =>
      validateWallLayoutDoc({ tile_4x4: { look: { mosaic: "16" } } }, "fixture"),
    ).toThrow(msg);
  });

  it("accepts mosaic 8", () => {
    expect(() =>
      validateWallLayoutDoc({ tile_4x4: { look: { mosaic: "8" } } }, "fixture"),
    ).not.toThrow();
  });
});
