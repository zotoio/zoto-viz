import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "./scene";
import {
  applyDreamAnimWithTileLimit,
  countMosaicTiles,
  MOSAIC_TILE_LIMIT_MESSAGE,
} from "./mosaic-viz-tile-guard";

describe("mosaic viz tile guard H6", () => {
  it("H6: reload with nine mosaicTiles is refused; current anim unchanged", () => {
    const current = {
      ...DEFAULT_DREAM,
      mosaic: "8" as const,
      mosaicTiles: ["a", "b", "c", "d", "e", "f", "g", "h"],
    };
    const incoming = {
      ...current,
      mosaicTiles: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    };
    expect(countMosaicTiles(incoming)).toBe(9);
    const out = applyDreamAnimWithTileLimit(incoming, current);
    expect(out.refused).toBe(true);
    expect(out.message).toBe(MOSAIC_TILE_LIMIT_MESSAGE);
    expect(out.anim.mosaicTiles).toEqual(current.mosaicTiles);
    expect(out.anim.mosaic).toBe("8");
  });
});
