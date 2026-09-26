import { describe, expect, it } from "vitest";
import { configStoreId, loadPluginConfig, writePluginConfig } from "./plugin";
import { fillPluginFields, pluginSettingsPanelValues } from "./plugin-ui";
import { PRESET_BASE_META_KEY } from "./plugin-settings";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";

describe("undo preserves meta keys", () => {
  it("restores settings from the snapshot and leaves __presetBase unchanged by the undo pass", () => {
    localStorage.clear();
    const spec = loadSettingsDeclFixture();
    const fields = spec.config!;
    const storeId = configStoreId(spec);
    writePluginConfig(storeId, {
      preset: "custom",
      gain: "3",
      mode: "x",
      locked: "0.5",
      [PRESET_BASE_META_KEY]: "a",
    });

    const host = document.createElement("div");
    let values: Record<string, string> = {};
    fillPluginFields(host, spec, fields, (_id, v) => { values = v; });

    const randomise = host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]');
    randomise!.click();

    const randomisedGain = values.gain;
    const live = pluginSettingsPanelValues(host)!;
    live[PRESET_BASE_META_KEY] = "corrupt-meta";

    const undo = host.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]');
    undo!.click();

    const after = loadPluginConfig(spec, fields);
    expect(after.gain).toBe("3");
    expect(after.gain).not.toBe(randomisedGain);
    expect(after[PRESET_BASE_META_KEY]).toBe("corrupt-meta");
  });
});
