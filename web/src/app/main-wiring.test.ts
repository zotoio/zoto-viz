import { describe, expect, it, vi } from "vitest";
import type { ViewMode } from "../core/modes";
import { loadPluginConfigCached, writePluginConfig, type PluginView } from "../plugins/plugin";
import { PRESET_BASE_META_KEY, packConfigValues } from "../plugins/plugin-settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { syncMosaicPluginCaptions } from "../plugins/plugin-hud-sync";
import { bootPluginSettingsHost } from "./app-plugin-settings-boot";
import * as wireHost from "./wire-settings-host";
import { pluginOptsFromSpec } from "./plugin-mode-opts";

describe("bootPluginSettingsHost (main.ts boot delegate)", () => {
  it("calls wireSettingsHost with deps", () => {
    const spy = vi.spyOn(wireHost, "wireSettingsHost").mockReturnValue(() => {});
    const deps = {
      modeById: () => ({ id: "plugin:a", label: "A", hint: "", legend: () => [], pluginId: "a" }),
      pluginSpecForMode: () => loadSettingsDeclFixture(),
      optsFor: () => ({}),
      captions: new Map(),
      getMosaicHost: () => null,
    };
    bootPluginSettingsHost(deps);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toBe(deps);
    spy.mockRestore();
  });
});

describe("wireSettingsHost", () => {
  it("updates captions map and syncs mosaic when sink fires", () => {
    const captions = new Map<string, string | null>();
    const setCaption = vi.fn();
    const spec = loadSettingsDeclFixture();
    wireHost.wireSettingsHost(
      {
        modeById: () => ({ id: "plugin:settings-fixture", label: "S", hint: "", legend: () => [], pluginId: "settings-fixture" }),
        pluginSpecForMode: () => spec,
        optsFor: () => ({}),
        captions,
        getMosaicHost: () => ({
          on: true,
          tileIds: ["plugin:settings-fixture"],
          setPaneSettingsCaption: setCaption,
        }),
      },
      (fn) => fn(spec, "caption"),
    );
    expect(captions.get("plugin:settings-fixture")).toBe("caption");
    expect(setCaption).toHaveBeenCalled();
  });

  it("resolveMosaicTileHudRow returns null when mosaic is off (guard in syncMosaicPluginCaptions)", () => {
    const setCaption = vi.fn();
    syncMosaicPluginCaptions(
      { on: false, tileIds: ["plugin:settings-fixture"], setPaneSettingsCaption: setCaption },
      new Map(),
      () => ({
        mode: { id: "plugin:settings-fixture", label: "S", pluginId: "settings-fixture" },
        spec: loadSettingsDeclFixture(),
        opts: {},
        fields: loadSettingsDeclFixture().config!,
      }),
    );
    expect(setCaption).not.toHaveBeenCalled();
  });
});

describe("wirePluginFrontendAttach (main.ts delegate)", () => {
  it("resets sandbox config batcher before attach", async () => {
    const steps: string[] = [];
    await wireHost.wirePluginFrontendAttach(
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
      hint: "",
      legend: () => [],
      pluginId: "opts-pack",
      config: spec.config,
    };
    const opts = pluginOptsFromSpec(mode, spec);
    expect(opts.gain).toBe("3");
    expect(opts[PRESET_BASE_META_KEY]).toBeUndefined();
    expect(packConfigValues(loadPluginConfigCached(spec, spec.config!))[PRESET_BASE_META_KEY]).toBeUndefined();
  });
});
