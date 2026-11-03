/**
 * A 4×4 wall is 16 tiles. 2×4 and smaller stay as they are. Dice never rolls 4×4.
 * A saved wall of 17 tiles is refused and storage is left alone.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { diceMosaic, DEFAULT_DICE } from "../core/shuffle";
import { DEFAULT_DREAM, MOSAIC_SIZES } from "./scene";
import { defaultTree, leafIds, parseMosaicTiles } from "./mosaic-layout";
import { allocateMosaicTileSlot } from "./mosaic-tile-id";
import { dreamAnimBootFromStorage } from "./mosaic-viz-tile-guard";
import { VIZ_MAX_ACTIVE_TILES } from "../plugins/viz-tile-constants";

describe("4×4 wall", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it("(1) 4×4 builds 16 panes of 16 different views; a repeated view never gets a !n copy", () => {
    expect(VIZ_MAX_ACTIVE_TILES).toBe(16);
    expect(allocateMosaicTileSlot("plugin:cores", ["plugin:cores"])).toBe("plugin:cores");
    const slots = Array.from({ length: 16 }, (_, i) => `plugin:v${i}`);
    expect(parseMosaicTiles(slots)).toHaveLength(16);
    const ids = leafIds(defaultTree(slots, "off"));
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    expect(leafIds(defaultTree(["plugin:cores", "plugin:cores!1", "plugin:memory"], "off"))).toEqual(["plugin:cores", "plugin:memory"]);
  });

  it("(2) a saved 17-tile wall is refused and storage stays", () => {
    const seventeen = "abcdefghijklmnopq".split("");
    const raw = JSON.stringify(seventeen);
    localStorage.setItem("zoto-viz.anim.mosaicTiles", raw);
    const loaded = { ...DEFAULT_DREAM, mosaic: "16" as const, mosaicTiles: [] as string[] };
    const boot = dreamAnimBootFromStorage(loaded, seventeen);
    expect(boot.bootRefused).toBe(true);
    expect(boot.anim.mosaic).toBe("off");
    expect(localStorage.getItem("zoto-viz.anim.mosaicTiles")).toBe(raw);
  });

  it("(3) a dice roll never produces 16", () => {
    for (const max of ["4", "6", "8"] as const) {
      expect(diceMosaic({ ...DEFAULT_DICE, mosaicMax: max }).includes("16")).toBe(false);
    }
  });

  it("(4) the tile_4x4 snippets are 16 tiles", () => {
    for (const id of ["aquarium", "koi-pond"]) {
      const doc = parse(readFileSync(resolve(import.meta.dirname, `../../../plugins/src/${id}/wall-layout.yml`), "utf8")) as {
        tile_4x4: { look: { mosaic: string; mosaicTiles: string[] } };
      };
      expect(doc.tile_4x4.look.mosaic).toBe("16");
      expect(doc.tile_4x4.look.mosaicTiles).toHaveLength(16);
    }
  });

  it("(5) the wall picker lists 1×, 2×2, 2×3, 2×4, 4×4", () => {
    expect(MOSAIC_SIZES.map((o) => o.label)).toEqual(["1×", "2×2", "2×3", "2×4", "4×4"]);
    expect(MOSAIC_SIZES.map((o) => o.value)).toEqual(["off", "4", "6", "8", "16"]);
  });
});
