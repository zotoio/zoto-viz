import { describe, expect, it, vi } from "vitest";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { fillPluginFields } from "../plugins/plugin-ui";
import { packScopeNoteText } from "../plugins/instances";
import { hostModeById } from "./host-mode";
import { setPluginModes } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { Settings } from "../ui/settings";
import { syncPluginFieldsFromSettingsEdit } from "./plugin-fields-from-settings";

const PACK = "plugin:settings-fixture";

describe("duplicate slot shared config > scope note when two tiles share one store", () => {
  it("shows Changes apply to all 2 when the pack is on two mosaic slots", () => {
    const spec = loadSettingsDeclFixture();
    const scope = {
      mosaicOn: true,
      tileModeIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
    };
    expect(packScopeNoteText(spec, scope)).toBe(
      `Changes apply to all 2 ${spec.name} tiles on this wall`,
    );
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")?.textContent).toContain("2");
  });

  it("hides the shared scope note when the pack is on only one tile", () => {
    const spec = loadSettingsDeclFixture();
    const scope = { mosaicOn: true, tileModeIds: ["plugin:settings-fixture", "plugin:topology"] };
    expect(packScopeNoteText(spec, scope)).toBeNull();
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {}, { wallScope: scope });
    expect(host.querySelector(".plugin-pack-scope-note")).toBeNull();
  });
});

describe("duplicate slot shared config > live edit applies to every sharing tile", () => {
  it("calls setMode on both duplicate tiles via main onPluginFields mosaic sync", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-shared-sync", onChange: () => {} });
    settings.openView(`${PACK}!1`);
    const sceneA = { setMode: vi.fn() };
    const sceneB = { setMode: vi.fn() };
    const mosaic = {
      on: true,
      tileIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
      graphScene: (id: string) => (id === "plugin:settings-fixture" ? sceneA : sceneB),
    };
    const opts = { gain: "9", preset: "a", mode: "x", locked: "0.5" };
    syncPluginFieldsFromSettingsEdit({
      settings,
      fallbackModeId: () => PACK,
      hostModeById,
      optsFor: () => opts,
      mosaic,
      scene: { setMode: vi.fn() },
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      setCurrentOpts: () => {},
      setSkyPrompt: () => {},
      setNestLook: () => {},
      viewPromptKey: "prompt",
    });
    expect(sceneA.setMode).toHaveBeenCalled();
    expect(sceneB.setMode).toHaveBeenCalled();
    expect(sceneA.setMode.mock.calls[0]![0].id).toBe("plugin:settings-fixture");
    expect(sceneB.setMode.mock.calls[0]![0].id).toBe("plugin:settings-fixture!1");
    expect(sceneA.setMode.mock.calls[0]![1]).toEqual(opts);
    expect(sceneB.setMode.mock.calls[0]![1]).toEqual(opts);
  });

  it("uses settings viewFocus instead of the catalog fallback mode id", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const settings = new Settings({ storePrefix: "zoto-view-focus", onChange: () => {} });
    settings.openView(`${PACK}!1`);
    const sceneFocused = { setMode: vi.fn() };
    const sceneOther = { setMode: vi.fn() };
    const mosaic = {
      on: true,
      tileIds: ["plugin:settings-fixture", "plugin:settings-fixture!1"],
      graphScene: (id: string) => (id === "plugin:settings-fixture!1" ? sceneFocused : sceneOther),
    };
    const opts = { gain: "3", preset: "a", mode: "x", locked: "0.5" };
    syncPluginFieldsFromSettingsEdit({
      settings,
      fallbackModeId: () => PACK,
      hostModeById,
      optsFor: () => opts,
      mosaic,
      scene: { setMode: vi.fn() },
      pluginSpecForMode: (modeId) => (hostModeById(modeId).pluginId === "settings-fixture" ? spec : null),
      setCurrentOpts: () => {},
      setSkyPrompt: () => {},
      setNestLook: () => {},
      viewPromptKey: "prompt",
    });
    expect(settings.viewFocus).toBe(`${PACK}!1`);
    expect(sceneFocused.setMode).toHaveBeenCalled();
    expect(sceneOther.setMode).not.toHaveBeenCalled();
  });
});
