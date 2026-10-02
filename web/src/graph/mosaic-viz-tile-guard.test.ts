import { describe, beforeEach, expect, it } from "vitest";
import { DEFAULT_DREAM } from "./scene";
import { mosaicWallLayoutRefusedMessage } from "../ui/viz-copy";
import { VIZ_MAX_ACTIVE_TILES } from "../plugins/viz-tile-constants";
import { applyDreamAnimWithTileLimit, countMosaicTiles, dreamAnimBootFromStorage } from "./mosaic-viz-tile-guard";

describe("mosaic viz tile guard", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("dreamAnimBootFromStorage refuses seventeen saved tile ids", () => {
    const seventeen = "abcdefghijklmnopq".split("");
    const loaded = { ...DEFAULT_DREAM, mosaic: "8" as const, mosaicTiles: [] };
    const boot = dreamAnimBootFromStorage(loaded, seventeen);
    expect(boot.bootRefused).toBe(true);
    expect(boot.message).toBe(
      "Couldn't load your saved wall layout. It has 17 tiles and the limit is 16, so the default view is showing.",
    );
  });

  it("applyDreamAnimWithTileLimit refuses seventeen tiles with formatted copy", () => {
    const sixteen = "abcdefghijklmnop".split("");
    const current = {
      ...DEFAULT_DREAM,
      mosaic: "8" as const,
      mosaicTiles: sixteen,
    };
    const incoming = {
      ...current,
      mosaicTiles: [...sixteen, "q"],
    };
    expect(countMosaicTiles(incoming)).toBe(17);
    const out = applyDreamAnimWithTileLimit(incoming, current);
    expect(out.refused).toBe(true);
    expect(out.message).toBe(mosaicWallLayoutRefusedMessage(17, VIZ_MAX_ACTIVE_TILES));
    expect(out.message).toBe(
      "Couldn't load this wall layout. It has 17 tiles and the limit is 16, so your current wall is still showing.",
    );
    expect(out.anim.mosaicTiles).toEqual(current.mosaicTiles);
    expect(out.anim.mosaic).toBe("8");
  });
});
