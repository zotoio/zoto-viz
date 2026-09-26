import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { countTilesSharingConfigStore } from "../plugins/instances";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { packWallScopeFromAnim } from "../plugins/pack-wall-scope";
import { Settings } from "../ui/settings";
import * as viewDrawerModule from "../ui/view-drawer-module";
import { hostModeById } from "./host-mode";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
  pickMosaicSlot,
} from "./duplicate-slot-mosaic-fixture";
import {
  expectVisibleFocusTarget,
  mosaicLayoutPickerTrigger,
  settingsViewDrawerRoot,
  viewDrawerStatusLine,
} from "./duplicate-slot-scope-note-test-dom";

const PACK = "plugin:settings-fixture";
const DISCARD_MSG = (name: string) =>
  `Your unsaved ${name} changes were discarded because its last tile was removed.`;

function mountLiveFixture() {
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

  return { spec, settings, mosaic, bindThisView };
}

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function scopeNotes(s: Settings): HTMLElement[] {
    return [...settingsViewDrawerRoot(s).querySelectorAll(".plugin-pack-scope-note")];
  }

  function scopeNoteCount(s: Settings): number | null {
    const notes = scopeNotes(s);
    if (!notes.length) return null;
    const text = notes[0]?.textContent ?? "";
    const m = /all (\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  }

  function viewSection(s: Settings): HTMLElement {
    const el = settingsViewDrawerRoot(s).querySelector<HTMLElement>('.plugin-layer[data-layer="view"]');
    expect(el).toBeTruthy();
    return el!;
  }

  function gainSlider(s: Settings): HTMLInputElement {
    const el = settingsViewDrawerRoot(s).querySelector<HTMLInputElement>(
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
    expect(settingsViewDrawerRoot(settings)).toBe(settings.el.querySelector(".settings-pop.drawer"));
    expect(viewSection(settings)).toBe(viewLayer);
    expect(viewLayer.isConnected).toBe(true);
    expect(document.activeElement).toBe(gain);
    expect(gain.value).toBe(typed);
    expect(settings.isOpen).toBe(true);
  }

  it("same drawer node, unsaved field, n=1→2→3→2→1 via slot picker, note text and focus preserved", async () => {
    const { spec, settings, mosaic, bindThisView } = mountLiveFixture();

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

    pickMosaicSlot(settings, 2, PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 3 ${spec.name} tiles on this wall`,
    );

    pickMosaicSlot(settings, 2, "plugin:topology");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)[0]?.textContent).toBe(
      `Changes apply to all 2 ${spec.name} tiles on this wall`,
    );

    pickMosaicSlot(settings, 1, "plugin:memory");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(scopeNotes(settings)).toHaveLength(0);
    expect(settingsViewDrawerRoot(settings).textContent).not.toMatch(/Changes apply to all 1/);
    const wall = packWallScopeFromAnim(settings.animSettings);
    expect(countTilesSharingConfigStore(spec, wall.tileModeIds)).toBe(1);

    settings.el.remove();
  });

  it("drawer view layer stays the same node when picking another slot of the same pack", async () => {
    const { settings, mosaic, bindThisView } = mountLiveFixture();
    const rebuildSpy = vi.spyOn(viewDrawerModule, "rebuildViewDrawerContent");
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const viewLayer = viewSection(settings);
    const gain = gainSlider(settings);
    gain.focus();
    gain.value = "7";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    rebuildSpy.mockClear();

    bindThisView(`${PACK}!2`);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(rebuildSpy).not.toHaveBeenCalled();

    pickMosaicSlot(settings, 2, "plugin:topology");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    expect(settings.viewFocus).toBe(PACK);
    expect(scopeNoteCount(settings)).toBe(2);
    rebuildSpy.mockRestore();
  });

  it("vertical layout patch does not rebuild the view drawer while editing", async () => {
    const { settings, mosaic, bindThisView } = mountLiveFixture();
    const rebuildSpy = vi.spyOn(viewDrawerModule, "rebuildViewDrawerContent");

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
    rebuildSpy.mockClear();

    const tilesAtTwo = [...settings.animSettings.mosaicTiles];
    applyWallLayoutPatch(settings, {
      tree: {
        type: "split",
        dir: "v",
        ratio: 0.5,
        a: { type: "leaf", id: tilesAtTwo[0]! },
        b: { type: "leaf", id: tilesAtTwo[1]! },
      },
      maximized: null,
      tiles: tilesAtTwo,
    });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    expect(rebuildSpy).not.toHaveBeenCalled();
    assertDrawerEditingStable(settings, viewLayer, gain, "7");
    rebuildSpy.mockRestore();
  });

  it("shows discard status when the last pack tile is removed with unsaved edits", async () => {
    const { spec, settings, mosaic, bindThisView } = mountLiveFixture();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(`${PACK}!1`);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    const gain = gainSlider(settings);
    gain.focus();
    gain.value = "9";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settings.pop.dataset.viewPluginDirty).toBe("1");

    const layoutTrigger = mosaicLayoutPickerTrigger(settings);
    pickMosaicSlot(settings, 1, "plugin:memory");
    pickMosaicSlot(settings, 0, "plugin:topology");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    expect(settings.isOpen).toBe(true);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(viewDrawerStatusLine(settings)?.textContent).toBe(DISCARD_MSG(spec.name));
    expect(viewDrawerStatusLine(settings)?.classList.contains("fail")).toBe(false);
    expect(document.activeElement).toBe(layoutTrigger);
    expect(layoutTrigger.getAttribute("aria-label")).toBe("Layout");
    expectVisibleFocusTarget(layoutTrigger);
  });

  it("closes the view drawer after the last pack tile leaves the wall", async () => {
    const { settings, mosaic, bindThisView } = mountLiveFixture();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    settings.clearViewDrawerStatus();

    const layoutTrigger = mosaicLayoutPickerTrigger(settings);
    pickMosaicSlot(settings, 0, "plugin:memory");
    pickMosaicSlot(settings, 1, "plugin:disk");
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    expect(settings.isOpen).toBe(false);
    expect(viewDrawerStatusLine(settings)).toBeNull();
    expect(document.activeElement).toBe(layoutTrigger);
  });
});
