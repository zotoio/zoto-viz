import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "./scene";
import { mosaicWallLayoutRefusedMessage } from "../ui/viz-copy";
import { VIZ_MAX_ACTIVE_TILES } from "../plugins/viz-tile-constants";
import { applyDreamAnimWithTileLimit, countMosaicTiles } from "./mosaic-viz-tile-guard";

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
    expect(out.message).toBe(mosaicWallLayoutRefusedMessage(9, VIZ_MAX_ACTIVE_TILES));
    expect(out.message).toBe(
      "Couldn't load this wall layout. It has 9 tiles and the limit is 8, so your current wall is still showing.",
    );
    expect(out.anim.mosaicTiles).toEqual(current.mosaicTiles);
    expect(out.anim.mosaic).toBe("8");
  });
});
