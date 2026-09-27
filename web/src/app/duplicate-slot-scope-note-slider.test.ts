import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import * as pluginModule from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import * as viewDrawer from "../ui/view-drawer-module";
import { hostModeById } from "./host-mode";
import { applyWallLayoutPatch } from "./mosaic-wall-layout";
import { settingsViewDrawerRoot } from "./test/duplicate-slot-scope-note-test-dom";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
} from "./test/duplicate-slot-mosaic-fixture";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > plugin field persist", () => {
  let writeConfigSpy: ReturnType<typeof vi.spyOn>;
  let rebuildDrawerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    writeConfigSpy = vi.spyOn(pluginModule, "writePluginConfig");
    rebuildDrawerSpy = vi.spyOn(viewDrawer, "rebuildViewDrawerContent");
  });

  afterEach(() => {
    writeConfigSpy.mockRestore();
    rebuildDrawerSpy.mockRestore();
  });

  function gainSlider(s: Settings): HTMLInputElement {
    const el = settingsViewDrawerRoot(s).querySelector<HTMLInputElement>(
      '.plugin-layer[data-layer="view"] .slider input[type=range]',
    );
    expect(el).toBeTruthy();
    return el!;
  }

  async function openFixtureDrawer(): Promise<{ settings: Settings; spec: ReturnType<typeof loadSettingsDeclFixture> }> {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
      compilePlugin({ id: "topology", packName: "Topology", version: 1, engine: "graph", base: "topology" }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-scope-note-slider", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic, bindThisView } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      lookForMode: () => null,
      fallbackModeId: () => PACK,
    });
    applyMosaicTiles(settings, mosaic, [PACK, "plugin:topology", "plugin:memory", "plugin:disk"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(r));
    return { settings, spec };
  }

  it("range input previews without storage write; change persists once", async () => {
    const { settings } = await openFixtureDrawer();
    const gain = gainSlider(settings);
    writeConfigSpy.mockClear();
    gain.value = "3";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    expect(writeConfigSpy).not.toHaveBeenCalled();
    expect(gain.value).toBe("3");
    gain.dispatchEvent(new Event("change", { bubbles: true }));
    expect(writeConfigSpy).toHaveBeenCalledTimes(1);
    settings.el.remove();
  });

  it("layout change mid-drag keeps slider focus, value, and one write on release", async () => {
    const { settings } = await openFixtureDrawer();
    const gain = gainSlider(settings);
    gain.focus();
    gain.value = "8";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    expect(writeConfigSpy).not.toHaveBeenCalled();
    rebuildDrawerSpy.mockClear();
    const twoTiles = [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"];
    applyWallLayoutPatch(settings, {
      tree: {
        type: "split",
        dir: "h",
        ratio: 0.5,
        a: { type: "leaf", id: PACK },
        b: { type: "leaf", id: `${PACK}!1` },
      },
      maximized: null,
      tiles: twoTiles,
    });
    await new Promise<void>((r) => requestAnimationFrame(r));
    expect(rebuildDrawerSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(gain);
    expect(gain.value).toBe("8");
    writeConfigSpy.mockClear();
    gain.dispatchEvent(new Event("change", { bubbles: true }));
    expect(writeConfigSpy).toHaveBeenCalledTimes(1);
    settings.el.remove();
  });
});
