import { describe, expect, it, vi } from "vitest";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { applyPresetToValues } from "./plugin-settings";
import { hudCaptionFromOpts, syncPluginHudForMode } from "./plugin-hud-sync";
import type { PluginView } from "./plugin";

describe("plugin HUD sync", () => {
  it("updates caption map before persist callback reads it", () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const values: Record<string, string> = {};
    applyPresetToValues(spec, fields, values, "a");
    const captions = new Map<string, string | null>();
    const modeId = "plugin:settings-fixture";
    let readOnPersist: string | null = "unset";
    const cap = hudCaptionFromOpts(spec, fields, values);
    captions.set(modeId, cap);
    const persist = () => { readOnPersist = captions.get(modeId) ?? null; };
    persist();
    expect(readOnPersist).toBe("X · Alpha");
    values.gain = "9";
    const next = hudCaptionFromOpts(spec, fields, values);
    captions.set(modeId, next);
    persist();
    expect(readOnPersist).toBe("X · Custom");
  });

  it("uses settings caption HUD for non-demo packs after frontend attach", () => {
    const spec: PluginView = { ...loadSettingsDeclFixture(), id: "settings-fixture" };
    const hud = {
      setActive: vi.fn(),
      showSettingsCaptionHud: vi.fn(),
      hideSettingsCaptionHud: vi.fn(),
      setPackCaption: vi.fn(),
    };
    const captions = new Map<string, string | null>([["plugin:settings-fixture", "X · Alpha"]]);
    syncPluginHudForMode(
      { id: "plugin:settings-fixture", pluginId: "settings-fixture", label: "Fixture" },
      spec,
      captions,
      hud,
      false,
    );
    expect(hud.showSettingsCaptionHud).toHaveBeenCalledWith("Settings fixture");
    expect(hud.setActive).not.toHaveBeenCalled();
    expect(hud.setPackCaption).toHaveBeenCalledWith("X · Alpha");
  });

  it("does not use the global settings HUD when mosaic is on", () => {
    const spec = loadSettingsDeclFixture();
    const hud = {
      setActive: vi.fn(),
      showSettingsCaptionHud: vi.fn(),
      hideSettingsCaptionHud: vi.fn(),
      setPackCaption: vi.fn(),
    };
    const captions = new Map<string, string | null>([["plugin:settings-fixture", "X · Alpha"]]);
    syncPluginHudForMode(
      { id: "plugin:settings-fixture", pluginId: "settings-fixture", label: "Fixture" },
      spec,
      captions,
      hud,
      true,
    );
    expect(hud.showSettingsCaptionHud).not.toHaveBeenCalled();
    expect(hud.hideSettingsCaptionHud).toHaveBeenCalled();
  });
});
