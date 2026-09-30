import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import { makeViewCogButton } from "../ui/view-cog";
import * as viewDrawerModule from "../ui/view-drawer-module";
import { hostModeById } from "./host-mode";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
import { applyMosaicTiles, mountDuplicateSlotMosaicHarness, pickMosaicSlot } from "./test/duplicate-slot-mosaic-fixture";
import {
  expectVisibleFocusTarget,
  mosaicLayoutPickerTrigger,
  settingsViewDrawerRoot,
  viewDrawerStatusLine,
} from "./test/duplicate-slot-scope-note-test-dom";

const PACK = "plugin:settings-fixture";
const WALL4 = [PACK, "plugin:topology", "plugin:memory", "plugin:disk"] as const;
const DISCARD = (n: string) => `Your unsaved ${n} changes were discarded because its last tile was removed.`;
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function mountLive() {
  const spec = loadSettingsDeclFixture();
  setPluginModes([
    compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ...(["topology", "memory", "disk"] as const).map((id) => compilePlugin({ id, name: id, packName: id, version: 1, engine: "graph", base: id })),
  ]);
  const settings = new Settings({ storePrefix: "zoto-scope-note-live", onChange: () => {} });
  document.body.append(settings.el);
  const { mosaic, bindThisView } = mountDuplicateSlotMosaicHarness(settings, {
    hostModeById,
    pluginSpecForMode: (id) => (hostModeById(id).pluginId === "settings-fixture" ? spec : null),
    lookForMode: () => null,
    fallbackModeId: () => PACK,
  });
  return { spec, settings, mosaic, bindThisView };
}

function gain(s: Settings) {
  const el = settingsViewDrawerRoot(s).querySelector<HTMLInputElement>('.plugin-layer[data-layer="view"] .slider input[type=range]');
  expect(el).toBeTruthy();
  return el!;
}

async function editGain(s: Settings, v = "7", checkStable = false) {
  const layer = settingsViewDrawerRoot(s).querySelector<HTMLElement>('.plugin-layer[data-layer="view"]');
  expect(layer).toBeTruthy();
  const g = gain(s);
  g.focus();
  g.value = v;
  g.dispatchEvent(new Event("input", { bubbles: true }));
  await raf();
  if (checkStable) {
    expect(settingsViewDrawerRoot(s)).toBe(s.el.querySelector(".settings-pop.drawer"));
    expect(document.activeElement).toBe(g);
    expect(s.isOpen).toBe(true);
    expect(layer!.isConnected).toBe(true);
  }
  return { layer: layer!, g };
}

describe("duplicate slot shared config > scope note follows live tile count while drawer stays open", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { expect.hasAssertions(); localStorage.clear(); errSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); });

  it("hides pack scope note in drawer while only one pack tile is on the wall", async () => {
    const { settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [...WALL4]);
    bindThisView(PACK);
    settings.openView(PACK);
    await raf();
    await editGain(settings, "7", true);
    expect(settingsViewDrawerRoot(settings).querySelectorAll(".plugin-pack-scope-note")).toHaveLength(0);
  });

  it("shows pack scope note after second pack tile is placed via slot picker", async () => {
    const { spec, settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [...WALL4]);
    bindThisView(PACK);
    settings.openView(PACK);
    await raf();
    const { layer, g } = await editGain(settings);
    pickMosaicSlot(settings, 1, PACK);
    await editGain(settings, "7", true);
    const note = settingsViewDrawerRoot(settings).querySelector(".plugin-pack-scope-note");
    expect(note?.textContent).toBe(`Changes apply to all 2 ${spec.packName} tiles on this wall.`);
  });

  it("keeps pack scope notes in sync after replacing a non-pack tile via slot picker", async () => {
    const { settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, `${PACK}!2`, "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await raf();
    await editGain(settings);
    pickMosaicSlot(settings, 3, "plugin:topology");
    await raf();
    settings.openView(PACK);
    await raf();
    expect(gain(settings).value).toBe("7");
    const text = settingsViewDrawerRoot(settings).querySelector(".plugin-pack-scope-note")?.textContent ?? "";
    expect(Number(/all (\d+)/.exec(text)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("vertical layout patch does not rebuild the view drawer while editing", async () => {
    const { settings, mosaic, bindThisView } = mountLive();
    const rebuildSpy = vi.spyOn(viewDrawerModule, "rebuildViewDrawerContent");
    applyMosaicTiles(settings, mosaic, [...WALL4]);
    bindThisView(PACK);
    settings.openView(PACK);
    await raf();
    const { layer, g } = await editGain(settings);
    rebuildSpy.mockClear();
    const tiles = [...settings.animSettings.mosaicTiles];
    applyWallLayoutPatch(settings, {
      tree: { type: "split", dir: "v", ratio: 0.5, a: { type: "leaf", id: tiles[0]! }, b: { type: "leaf", id: tiles[1]! } },
      maximized: null,
      tiles,
    });
    await raf();
    expect(rebuildSpy).not.toHaveBeenCalled();
    expect(layer.isConnected).toBe(true);
    rebuildSpy.mockRestore();
  });

  it("shows discard status when the last pack tile is removed with unsaved edits", async () => {
    const { spec, settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(`${PACK}!1`);
    await raf();
    const g = gain(settings);
    g.focus();
    g.value = "9";
    g.dispatchEvent(new Event("input", { bubbles: true }));
    expect(settings["pop"].dataset.viewPluginDirty).toBe("1");
    const layoutTrigger = mosaicLayoutPickerTrigger(settings);
    pickMosaicSlot(settings, 1, "plugin:memory");
    pickMosaicSlot(settings, 0, "plugin:topology");
    await raf();
    expect(settings.isOpen).toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
    expect(viewDrawerStatusLine(settings)?.textContent).toBe(DISCARD(spec.packName ?? ""));
    expect(document.activeElement).toBe(layoutTrigger);
    expect(layoutTrigger.getAttribute("aria-label")).toBe("Layout");
    expectVisibleFocusTarget(layoutTrigger);
  });

  it("returns focus once to the Layout button when the last pack tile leaves and the drawer was opened from Layout", async () => {
    const { settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:disk"]);
    bindThisView(PACK);
    const layoutTrigger = mosaicLayoutPickerTrigger(settings);
    layoutTrigger.focus();
    settings.openView(PACK);
    await raf();
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    pickMosaicSlot(settings, 0, "plugin:memory");
    pickMosaicSlot(settings, 1, "plugin:disk");
    await raf();
    expect(settings.isOpen).toBe(false);
    expect(viewDrawerStatusLine(settings)).toBeNull();
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(layoutTrigger);
    focusSpy.mockRestore();
  });

  it("returns focus once to the pane menu cog when the last pack tile leaves and the drawer was opened from that menu", async () => {
    const { settings, mosaic, bindThisView } = mountLive();
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:disk"]);
    const paneCog = makeViewCogButton({
      className: "mosaic-pane-cog",
      pane: PACK,
      ariaLabel: "this pane settings",
      onClick: () => { bindThisView(PACK); settings.openView(PACK); },
    });
    document.body.append(paneCog);
    paneCog.focus();
    paneCog.click();
    await raf();
    const layoutTrigger = mosaicLayoutPickerTrigger(settings);
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    pickMosaicSlot(settings, 0, "plugin:memory");
    pickMosaicSlot(settings, 1, "plugin:disk");
    await raf();
    expect(settings.isOpen).toBe(false);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(paneCog);
    expect(document.activeElement).not.toBe(layoutTrigger);
    focusSpy.mockRestore();
    paneCog.remove();
  });
});
