import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { configStoreId, loadPluginConfig, writePluginConfig } from "./plugin";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields, resolvedPresetSelectValue } from "./plugin-ui";
import { resetDeclaredConfig, undoRingDepth } from "./plugin-settings";

describe("preset select single source of truth", () => {
  beforeEach(() => localStorage.clear());

  it("keeps select, storage, and HUD fields aligned after commit and reset", async () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const host = document.createElement("div");
    document.body.append(host);
    fillPluginFields(host, spec, fields, () => {});
    const sel = host.querySelector<HTMLSelectElement>('[data-toolbar-action="preset"]')!;
    await userEvent.selectOptions(sel, "b");
    expect(sel.value).toBe("b");
    expect(undoRingDepth(configStoreId(spec))).toBe(1);
    const stored = loadPluginConfig(spec, fields);
    expect(resolvedPresetSelectValue(spec, stored)).toBe("b");
    expect(stored.gain).toBe("6");
    expect(stored.mode).toBe("y");

    host.querySelector<HTMLButtonElement>('[data-toolbar-action="reset"]')!.click();
    const afterReset = loadPluginConfig(spec, fields);
    expect(resolvedPresetSelectValue(spec, afterReset)).toBe("a");
    expect(host.querySelector<HTMLSelectElement>('[data-toolbar-action="preset"]')!.value).toBe("a");
    expect(afterReset.gain).toBe("3");
    host.remove();
  });

  it("resetDeclaredConfig matches first preset values", () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const values: Record<string, string> = { preset: "custom", gain: "9", mode: "y", locked: "0" };
    resetDeclaredConfig(spec, fields, values);
    writePluginConfig(spec.id, values);
    expect(values.preset).toBe("a");
    expect(values.gain).toBe("3");
    expect(values.mode).toBe("x");
  });
});
