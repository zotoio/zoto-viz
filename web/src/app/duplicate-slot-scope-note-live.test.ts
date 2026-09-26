import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { countTilesSharingConfigStore } from "../plugins/instances";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { packWallScopeFromAnim } from "../plugins/pack-wall-scope";
import { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  beforeEach(() => localStorage.clear());

  function scopeNoteEl(s: Settings): HTMLElement | null {
    return s.el.querySelector(".plugin-pack-scope-note");
  }

  function scopeNoteCount(s: Settings): number | null {
    const text = scopeNoteEl(s)?.textContent ?? "";
    const m = /all (\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  }

  it("same drawer node, unsaved field, and n=2 then 3 then 1 while the view tab stays open", async () => {
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

    const drawer = settings.el;
    const gain = settings.el.querySelector<HTMLInputElement>(".slider input[type=range]");
    expect(gain).toBeTruthy();
    gain!.value = "7";
    gain!.dispatchEvent(new Event("input", { bubbles: true }));

    let note = scopeNoteEl(settings);
    expect(note).toBeTruthy();
    expect(scopeNoteCount(settings)).toBe(2);
    expect(settings.isOpen).toBe(true);

    const threeTiles = [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: threeTiles });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(settings.el).toBe(drawer);
    expect(gain!.value).toBe("7");
    note = scopeNoteEl(settings);
    expect(note).toBeTruthy();
    expect(scopeNoteCount(settings)).toBe(3);
    expect(scopeNoteEl(settings)?.textContent).toBe(
      `Changes apply to all 3 ${spec.name} tiles on this wall`,
    );

    const onePack = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: onePack });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(settings.el).toBe(drawer);
    expect(gain!.value).toBe("7");
    expect(settings.isOpen).toBe(true);
    expect(scopeNoteEl(settings)).toBeNull();
    const wall = packWallScopeFromAnim(settings.animSettings);
    expect(countTilesSharingConfigStore(spec, wall.tileModeIds)).toBe(1);

    settings.el.remove();
  });
});
