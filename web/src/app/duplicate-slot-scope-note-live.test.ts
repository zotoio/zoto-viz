import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  beforeEach(() => localStorage.clear());

  function scopeNoteText(s: Settings): string | null {
    return s.el.querySelector(".plugin-pack-scope-note")?.textContent ?? null;
  }

  it("updates n when duplicate tiles are added or removed via mosaic layout", async () => {
    const settings = new Settings({ storePrefix: "zoto-scope-note-live", onChange: () => {} });
    settings.addAnimation(() => {}, { el: document.createElement("div") });
    document.body.append(settings.el);

    const spec = loadSettingsDeclFixture();
    const twoTiles = [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"];
    settings.applyAnim({ ...DEFAULT_DREAM, mosaic: "4", mosaicTiles: twoTiles });
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: twoTiles });

    settings.bindView(spec, spec.config);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(scopeNoteText(settings)).toContain("2");
    expect(settings.isOpen).toBe(true);

    const threeTiles = [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: threeTiles });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(scopeNoteText(settings)).toBe(`Changes apply to all 3 ${spec.name} tiles on this wall`);

    const onePack = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: onePack });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(scopeNoteText(settings)).toBeNull();
    expect(settings.isOpen).toBe(true);

    settings.el.remove();
  });
});
