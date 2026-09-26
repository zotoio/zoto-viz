import { describe, expect, it, vi } from "vitest";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { resolveMosaicTileHudRow, syncMosaicPluginHudCaptions } from "./mosaic-hud-wiring";

describe("syncMosaicPluginHudCaptions", () => {
  it("does nothing when mosaic is off (early return)", () => {
    const setCaption = vi.fn();
    syncMosaicPluginHudCaptions(
      { on: false, tileIds: ["plugin:a"], setPaneSettingsCaption: setCaption },
      new Map([["plugin:a", "X · Alpha"]]),
      {
        modeById: () => ({ id: "plugin:a", label: "A", pluginId: "a" }),
        pluginSpecForMode: () => loadSettingsDeclFixture(),
        optsFor: () => ({}),
      },
    );
    expect(setCaption).not.toHaveBeenCalled();
  });

  it("writes captions only for tiles that resolve a HUD row", () => {
    const spec = loadSettingsDeclFixture();
    const setCaption = vi.fn();
    syncMosaicPluginHudCaptions(
      { on: true, tileIds: ["plugin:settings-fixture", "plugin:topology"], setPaneSettingsCaption: setCaption },
      new Map([["plugin:settings-fixture", "Alpha"]]),
      {
        modeById: (id) => ({
          id,
          label: id,
          pluginId: id === "plugin:settings-fixture" ? "settings-fixture" : "topology",
        }),
        pluginSpecForMode: (id) => (id === "plugin:settings-fixture" ? spec : null),
        optsFor: () => ({ preset: "a", gain: "3" }),
      },
    );
    expect(setCaption).toHaveBeenCalledTimes(2);
    expect(setCaption).toHaveBeenCalledWith(
      "plugin:settings-fixture",
      `${spec.name} · Alpha`,
    );
    expect(setCaption).toHaveBeenCalledWith("plugin:topology", null);
  });
});

describe("resolveMosaicTileHudRow", () => {
  it("resolves plugin spec for mosaic slot ids (!2 suffix)", () => {
    const spec = loadSettingsDeclFixture();
    const row = resolveMosaicTileHudRow("plugin:settings-fixture!2", {
      modeById: (id) => ({ id, label: "S", pluginId: "settings-fixture" }),
      pluginSpecForMode: (id) => (id === "plugin:settings-fixture" ? spec : null),
      optsFor: () => ({}),
    });
    expect(row?.spec.id).toBe("settings-fixture");
  });

  it("returns null for non-plugin tiles", () => {
    expect(resolveMosaicTileHudRow("topology", {
      modeById: () => ({ id: "topology", label: "Topology" }),
      pluginSpecForMode: () => null,
      optsFor: () => ({}),
    })).toBeNull();
  });
});
