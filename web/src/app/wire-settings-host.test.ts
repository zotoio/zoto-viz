import { describe, expect, it, vi } from "vitest";
import { setPluginModes, modeById } from "../core/modes";
import { compilePlugin } from "../plugins/plugin";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { hostModeById } from "./host-mode";
import { resolveMosaicTileHudRow, syncPluginHudCaptionsFromMap } from "./wire-settings-host";

describe("wire-settings-host", () => {
  it("resolveMosaicTileHudRow > resolves plugin spec for mosaic slot ids (!2 suffix)", () => {
    const spec = loadSettingsDeclFixture();
    setPluginModes([
      compilePlugin({ ...spec, engine: "graph", base: "topology", capabilities: ["config.read"] }),
    ]);
    const slotId = "plugin:settings-fixture!2";
    expect(modeById(slotId).id).not.toBe(slotId);
    const mode = hostModeById(slotId);
    expect(mode.id).toBe(slotId);
    expect(mode.pluginId).toBe("settings-fixture");
    const row = resolveMosaicTileHudRow(slotId, {
      modeById: hostModeById,
      pluginSpecForMode: (id) => (id === "plugin:settings-fixture" ? spec : null),
      optsFor: () => ({ preset: "a", gain: "3", mode: "x", locked: "0.5" }),
      captions: new Map(),
      getMosaicHost: () => null,
    });
    expect(row?.spec.id).toBe("settings-fixture");
    expect(row?.opts.gain).toBe("3");
  });

  it("syncPluginHudCaptionsFromMap > does nothing when mosaic is off", () => {
    const setCaption = vi.fn();
    syncPluginHudCaptionsFromMap({
      modeById: hostModeById,
      pluginSpecForMode: () => loadSettingsDeclFixture(),
      optsFor: () => ({}),
      captions: new Map([["plugin:a", "X · Alpha"]]),
      getMosaicHost: () => ({ on: false, tileIds: ["plugin:a"], setPaneSettingsCaption: setCaption }),
    });
    expect(setCaption).not.toHaveBeenCalled();
  });
});
