import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { countTilesSharingConfigStore } from "../plugins/instances";
import {
  readPackScopeNoteMetrics,
  resetPackScopeNoteMetrics,
} from "../plugins/pack-scope-note-metrics";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { packWallScopeFromAnim } from "../plugins/pack-wall-scope";
import { Settings } from "../ui/settings";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  beforeEach(() => localStorage.clear());

  function scopeNotes(s: Settings): HTMLElement[] {
    return [...s.el.querySelectorAll(".plugin-pack-scope-note")];
  }

  function scopeNoteCount(s: Settings): number | null {
    const text = scopeNotes(s)[0]?.textContent ?? "";
    const m = /all (\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  }

  it("same drawer node, unsaved field, n=2 then 3 then removed at 1, exactly 3 note writes", async () => {
    resetPackScopeNoteMetrics();
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

    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNoteCount(settings)).toBe(2);
    expect(settings.isOpen).toBe(true);
    expect(settings.el.textContent).not.toMatch(/all 1 /);

    const threeTiles = [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: threeTiles });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(settings.el).toBe(drawer);
    expect(gain!.value).toBe("7");
    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNoteCount(settings)).toBe(3);
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 3 ${spec.name} tiles on this wall`,
    );
    expect(settings.el.textContent).not.toMatch(/all 1 /);

    const onePack = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"];
    applyWallLayoutPatch(settings, { tree: null, maximized: null, tiles: onePack });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(settings.el).toBe(drawer);
    expect(gain!.value).toBe("7");
    expect(settings.isOpen).toBe(true);
    expect(scopeNotes(settings)).toHaveLength(0);
    expect(settings.el.textContent).not.toMatch(/Changes apply to all 1/);
    const wall = packWallScopeFromAnim(settings.animSettings);
    expect(countTilesSharingConfigStore(spec, wall.tileModeIds)).toBe(1);
    expect(readPackScopeNoteMetrics().textWrites).toBe(3);

    settings.el.remove();
  });
});
