import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { Settings } from "../ui/settings";
import * as viewDrawer from "../ui/view-drawer-module";
import { hostModeById } from "./host-mode";
import * as hostViewBind from "./host-view-bind";
import { settingsViewDrawerRoot } from "./test/duplicate-slot-scope-note-test-dom";
import {
  applyMosaicTiles,
  mountDuplicateSlotMosaicHarness,
} from "./test/duplicate-slot-mosaic-fixture";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > drawer rebind guards", () => {
  let rebuildDrawerSpy: ReturnType<typeof vi.spyOn>;
  let bindThisViewSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    rebuildDrawerSpy = vi.spyOn(viewDrawer, "rebuildViewDrawerContent");
    bindThisViewSpy = vi.spyOn(hostViewBind, "bindThisView");
  });

  afterEach(() => {
    rebuildDrawerSpy.mockRestore();
    bindThisViewSpy.mockRestore();
  });

  function viewLayer(s: Settings): HTMLElement {
    const el = settingsViewDrawerRoot(s).querySelector<HTMLElement>('.plugin-layer[data-layer="view"]');
    expect(el).toBeTruthy();
    return el!;
  }

  async function harness(): Promise<{
    settings: Settings;
    spec: ReturnType<typeof loadSettingsDeclFixture>;
    applyMode: (modeId: string) => void;
  }> {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
      compilePlugin({ id: "topology", packName: "Topology", version: 1, engine: "graph", base: "topology" }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-scope-note-guards", onChange: () => {} });
    document.body.append(settings.el);
    const { mosaic, bindThisView, applyMode } = mountDuplicateSlotMosaicHarness(settings, {
      hostModeById,
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      lookForMode: () => null,
      fallbackModeId: () => PACK,
    });
    applyMosaicTiles(settings, mosaic, [PACK, `${PACK}!1`, "plugin:topology", "plugin:memory"]);
    bindThisView(PACK);
    settings.openView(PACK);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return { settings, spec, applyMode };
  }

  it("applyMode keeps drawer DOM when drawer key unchanged", async () => {
    const { settings, applyMode } = await harness();
    bindThisViewSpy.mockClear();
    applyMode(PACK);
    expect(bindThisViewSpy).not.toHaveBeenCalled();
    settings.el.remove();
  });

  it("bindView skips rebuild when drawer key is unchanged", async () => {
    const { settings, spec } = await harness();
    const layer = viewLayer(settings);
    rebuildDrawerSpy.mockClear();
    settings.bindView(spec, spec.config);
    expect(rebuildDrawerSpy).not.toHaveBeenCalled();
    expect(viewLayer(settings)).toBe(layer);
    settings.el.remove();
  });

  it("closing settings clears view drawer key so reopening the same view rebuilds", async () => {
    const { settings, spec } = await harness();
    rebuildDrawerSpy.mockClear();
    settings.close();
    settings.openView(PACK);
    rebuildDrawerSpy.mockClear();
    settings.bindView(spec, spec.config, undefined, undefined, PACK);
    expect(rebuildDrawerSpy).toHaveBeenCalledTimes(1);
    settings.el.remove();
  });
});
