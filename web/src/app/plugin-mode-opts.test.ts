import { beforeEach, describe, expect, it } from "vitest";
import type { ViewMode } from "../core/modes";
import { writePluginConfig, type PluginView } from "../plugins/plugin";
import { PRESET_BASE_META_KEY } from "../plugins/plugin-settings";
import { pluginOptsFromSpec } from "./plugin-mode-opts";

describe("pluginOptsFromSpec (optsFor export path)", () => {
  beforeEach(() => localStorage.clear());

  it("omits __presetBase from plugin mode options", () => {
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
  });
});
