import { describe, expect, it, vi } from "vitest";
import type { ViewMode } from "../core/modes";
import { loadPluginConfigCached, writePluginConfig, type PluginView } from "../plugins/plugin";
import { PRESET_BASE_META_KEY, packConfigValues } from "../plugins/plugin-settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { syncMosaicPluginHudCaptions } from "./mosaic-hud-wiring";
import { attachPluginFrontendAfterConfigReset } from "./plugin-frontend-attach";
import { pluginOptsFromSpec } from "./plugin-mode-opts";

describe("mosaic HUD wiring (main.ts delegate)", () => {
  it("skips caption updates when mosaic host is off", () => {
    const setCaption = vi.fn();
    syncMosaicPluginHudCaptions(
      { on: false, tileIds: ["plugin:a"], setPaneSettingsCaption: setCaption },
      new Map(),
      {
        modeById: () => ({ id: "plugin:a", label: "A", pluginId: "a" }),
        pluginSpecForMode: () => loadSettingsDeclFixture(),
        optsFor: () => ({}),
      },
    );
    expect(setCaption).not.toHaveBeenCalled();
  });
});

describe("plugin frontend attach (main.ts delegate)", () => {
  it("resets sandbox config batcher before attach", async () => {
    const steps: string[] = [];
    await attachPluginFrontendAfterConfigReset(
      { reset: () => steps.push("reset") },
      async () => { steps.push("attach"); },
    );
    expect(steps).toEqual(["reset", "attach"]);
  });
});

describe("pluginOptsFromSpec (optsFor export path)", () => {
  it("omits __presetBase from exported mode options", () => {
    localStorage.clear();
    const spec: PluginView = {
      id: "opts-pack",
      name: "Opts",
      version: 1,
      engine: "graph",
      config: [{ key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 1 }],
    };
    writePluginConfig("opts-pack", { gain: "3", [PRESET_BASE_META_KEY]: "a" });
    const mode: ViewMode = {
      id: "plugin:opts-pack",
      label: "Opts",
      pluginId: "opts-pack",
      config: spec.config,
    };
    const opts = pluginOptsFromSpec(mode, spec);
    expect(opts.gain).toBe("3");
    expect(opts[PRESET_BASE_META_KEY]).toBeUndefined();
    expect(packConfigValues(loadPluginConfigCached(spec, spec.config!))[PRESET_BASE_META_KEY]).toBeUndefined();
  });
});
