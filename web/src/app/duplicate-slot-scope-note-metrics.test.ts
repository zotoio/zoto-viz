import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import {
  readPackScopeNoteMetrics,
  resetPackScopeNoteMetrics,
} from "../plugins/pack-scope-note-metrics";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > pack scope note write budget", () => {
  beforeEach(() => localStorage.clear());

  async function openFixtureDrawer(settings: Settings): Promise<void> {
    const spec = loadSettingsDeclFixture();
    const twoTiles = [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"];
    settings.applyAnim({ ...DEFAULT_DREAM, mosaic: "4", mosaicTiles: twoTiles });
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: twoTiles });
    settings.bindView(spec, spec.config);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    resetPackScopeNoteMetrics();
  }

  it("five layout patches with unchanged duplicate count perform 0 pack scope note text writes", async () => {
    const settings = new Settings({ storePrefix: "zoto-scope-note-writes", onChange: () => {} });
    settings.addAnimation(() => {}, { el: document.createElement("div") });
    document.body.append(settings.el);
    await openFixtureDrawer(settings);

    const twoTiles = [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"];
    const patches = [
      { tree: null, maximized: PACK, tiles: twoTiles },
      { tree: null, maximized: null, tiles: twoTiles },
      {
        tree: {
          type: "split",
          dir: "h",
          ratio: 0.45,
          a: { type: "leaf", id: PACK },
          b: { type: "leaf", id: `${PACK}!1` },
        },
        maximized: null,
        tiles: twoTiles,
      },
      {
        tree: null,
        maximized: null,
        tiles: twoTiles,
        uniqueSkies: true,
        skies: { [PACK]: "aurora" },
      },
      {
        tree: {
          type: "split",
          dir: "v",
          ratio: 0.55,
          a: { type: "leaf", id: PACK },
          b: { type: "leaf", id: "plugin:topology" },
        },
        maximized: null,
        tiles: twoTiles,
        uniqueSkies: false,
        skies: {},
      },
    ];
    for (const patch of patches) {
      applyWallLayoutPatch(settings, patch);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    expect(readPackScopeNoteMetrics()).toEqual({ recounts: 0, textWrites: 0 });
    settings.el.remove();
  });

  it("600 steady frames with drawer open: 0 recounts and 0 writes; one tile-count change: 1 and 1", async () => {
    const settings = new Settings({ storePrefix: "zoto-scope-note-steady", onChange: () => {} });
    settings.addAnimation(() => {}, { el: document.createElement("div") });
    document.body.append(settings.el);
    await openFixtureDrawer(settings);

    for (let i = 0; i < 600; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
    expect(readPackScopeNoteMetrics()).toEqual({ recounts: 0, textWrites: 0 });

    const threeTiles = [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: threeTiles });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(readPackScopeNoteMetrics()).toEqual({ recounts: 1, textWrites: 1 });

    settings.el.remove();
  });
});
