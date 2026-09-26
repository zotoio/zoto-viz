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

  function assertDrawerEditingStable(
    settings: Settings,
    viewLayer: HTMLElement,
    gain: HTMLInputElement,
    typed: string,
  ): void {
    expect(drawerRoot(settings)).toBe(settings.drawerEl);
    expect(viewSection(settings)).toBe(viewLayer);
    expect(viewLayer.isConnected).toBe(true);
    expect(document.activeElement).toBe(gain);
    expect(gain.value).toBe(typed);
    expect(settings.isOpen).toBe(true);
  }

  it("same drawer node, unsaved field, n=1→2→3→2→1 via slot picker, note text and focus preserved", async () => {
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

    const onePack = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"];
    applyMosaicTiles(settings, mosaic, onePack);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const viewLayer = viewSection(settings);
    const gain = gainSlider(settings);
    gain.focus();
    gain.value = "7";
    gain.dispatchEvent(new Event("input", { bubbles: true }));

    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)).toHaveLength(0);

    pickMosaicSlot(settings, 1, PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 2 ${spec.name} tiles on this wall`,
    );
    expect(scopeNoteCount(settings)).toBe(2);

    pickMosaicSlot(settings, 2, PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)).toHaveLength(1);
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 3 ${spec.name} tiles on this wall`,
    );
    expect(scopeNoteCount(settings)).toBe(3);

    pickMosaicSlot(settings, 2, "plugin:topology");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 2 ${spec.name} tiles on this wall`,
    );
    expect(scopeNoteCount(settings)).toBe(2);

    pickMosaicSlot(settings, 1, "plugin:memory");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)).toHaveLength(0);
    expect(drawerRoot(settings).textContent).not.toMatch(/Changes apply to all 1/);
    const wall = packWallScopeFromAnim(settings.animSettings);
    expect(countTilesSharingConfigStore(spec, wall.tileModeIds)).toBe(1);
    expect(readPackScopeNoteMetrics().textWrites).toBe(4);

    settings.el.remove();
  });
});
