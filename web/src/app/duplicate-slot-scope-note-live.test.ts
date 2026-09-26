import { beforeEach, describe, expect, it } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { countTilesSharingConfigStore } from "../plugins/instances";
import {
  readPackScopeNoteMetrics,
  resetPackScopeNoteMetrics,
} from "../plugins/pack-scope-note-metrics";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { packWallScopeFromAnim } from "../plugins/pack-wall-scope";
import { Settings } from "../ui/settings";
import { hostModeById } from "./host-mode";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
  pickMosaicSlot,
} from "./duplicate-slot-mosaic-fixture";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  beforeEach(() => localStorage.clear());

  function drawerRoot(s: Settings): HTMLElement {
    return s.drawerEl;
  }

  function scopeNotes(s: Settings): HTMLElement[] {
    return [...drawerRoot(s).querySelectorAll(".plugin-pack-scope-note")];
  }

  function scopeNoteCount(s: Settings): number | null {
    const text = scopeNotes(s)[0]?.textContent ?? "";
    const m = /all (\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  }

  function viewSection(s: Settings): HTMLElement {
    const el = drawerRoot(s).querySelector<HTMLElement>('.plugin-layer[data-layer="view"]');
    expect(el).toBeTruthy();
    return el!;
  }

  function gainSlider(s: Settings): HTMLInputElement {
    const el = drawerRoot(s).querySelector<HTMLInputElement>(
      '.plugin-layer[data-layer="view"] .slider input[type=range]',
    );
    expect(el).toBeTruthy();
    return el!;
  }

  it("same drawer node, unsaved field, n=2 then 3 then removed at 1, exactly 3 note writes", async () => {
    resetPackScopeNoteMetrics();
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
      compilePlugin({ id: "topology", name: "Topology", version: 1, engine: "graph", base: "topology" }),
      compilePlugin({ id: "memory", name: "Memory", version: 1, engine: "graph", base: "memory" }),
      compilePlugin({ id: "disk", name: "Disk", version: 1, engine: "graph", base: "disk" }),
    ]);

    const settings = new Settings({ storePrefix: "zoto-scope-note-live", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic, bindThisView } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      lookForMode: () => null,
      fallbackModeId: () => PACK,
    });

    const twoTiles = [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"];
    applyMosaicTiles(settings, mosaic, twoTiles);
    bindThisView(`${PACK}!1`);
    settings.openView(`${PACK}!1`);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const viewLayer = viewSection(settings);
    let gain = gainSlider(settings);
    gain.value = "7";
    gain.dispatchEvent(new Event("input", { bubbles: true }));

    expect(viewLayer.isConnected).toBe(true);
    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNoteCount(settings)).toBe(2);
    expect(settings.isOpen).toBe(true);

    pickMosaicSlot(settings, 3, "plugin:disk");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(viewSection(settings)).toBe(viewLayer);
    expect(scopeNoteCount(settings)).toBe(2);

    const threeTiles = [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:topology"];
    applyMosaicTiles(settings, mosaic, threeTiles);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(viewSection(settings)).toBe(viewLayer);
    expect(viewLayer.isConnected).toBe(true);
    gain = gainSlider(settings);
    expect(gain.value).toBe("7");
    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNoteCount(settings)).toBe(3);
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 3 ${spec.name} tiles on this wall`,
    );

    const onePack = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"];
    applyMosaicTiles(settings, mosaic, onePack);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(viewSection(settings)).toBe(viewLayer);
    expect(viewLayer.isConnected).toBe(true);
    gain = gainSlider(settings);
    expect(gain.value).toBe("7");
    expect(settings.isOpen).toBe(true);
    expect(scopeNotes(settings)).toHaveLength(0);
    expect(drawerRoot(settings).textContent).not.toMatch(/Changes apply to all 1/);
    const wall = packWallScopeFromAnim(settings.animSettings);
    expect(countTilesSharingConfigStore(spec, wall.tileModeIds)).toBe(1);
    expect(readPackScopeNoteMetrics().textWrites).toBe(3);

    settings.el.remove();
  });
});
