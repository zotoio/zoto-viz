import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { packScopeNoteText } from "./instances";
import { packWallScopeFromAnim } from "./pack-wall-scope";

function mosaicPackSpec() {
  return {
    ...loadSettingsDeclFixture(),
    id: "settings-mosaic",
    instances: [{ id: "tile-a" }, { id: "tile-b" }],
  };
}

describe("pack wall scope (production-shaped)", () => {
  const spec = loadSettingsDeclFixture();

  it("hides shared scope note on 2×2 wall with two different packs", () => {
    const scope = packWallScopeFromAnim({
      ...DEFAULT_DREAM,
      mosaic: "4",
      mosaicTiles: ["plugin:settings-fixture", "plugin:topology"],
    });
    expect(scope.mosaicOn).toBe(true);
    expect(packScopeNoteText(spec, scope)).toBeNull();
  });

  it("hides shared scope note when base pack and instance tile share a pack id but not storage", () => {
    const mosaic = mosaicPackSpec();
    const scope = packWallScopeFromAnim({
      ...DEFAULT_DREAM,
      mosaic: "4",
      mosaicTiles: ["plugin:settings-mosaic", "plugin:settings-mosaic:tile-a"],
    });
    expect(packScopeNoteText(mosaic, scope)).toBeNull();
  });

  it("shows shared note when wallScope lists two tiles with the same config store", () => {
    expect(packScopeNoteText(spec, {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-fixture", "plugin:settings-fixture"],
    })).toContain("Applies to all");
  });

  it("packWallScopeFromAnim dedupes tile ids so shared note stays hidden until duplicate tiles ship", () => {
    const scope = packWallScopeFromAnim({
      ...DEFAULT_DREAM,
      mosaic: "4",
      mosaicTiles: ["plugin:settings-fixture", "plugin:settings-fixture"],
    });
    expect(scope.tileModeIds).toEqual(["plugin:settings-fixture"]);
    expect(packScopeNoteText(spec, scope)).toBeNull();
  });
});
