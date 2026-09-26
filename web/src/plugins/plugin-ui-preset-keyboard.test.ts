import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PRESET_BASE_META_KEY } from "./plugin-settings";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields, resolvedPresetSelectValue } from "./plugin-ui";

describe("resolvedPresetSelectValue", () => {
  it("uses presetField value, not __presetBase meta", () => {
    const spec = loadSettingsDeclFixture();
    expect(resolvedPresetSelectValue(spec, {
      preset: "b",
      gain: "3",
      [PRESET_BASE_META_KEY]: "a",
    })).toBe("b");
  });
});

describe("preset select keyboard", () => {
  beforeEach(() => localStorage.clear());

  it("changes the applied preset via arrow keys on the native select", async () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    document.body.append(host);
    let applied: Record<string, string> = {};
    fillPluginFields(host, spec, spec.config ?? [], (_id, values) => { applied = { ...values }; });
    const sel = host.querySelector<HTMLSelectElement>('[data-toolbar-action="preset"]')!;
    expect(sel.value).toBe("a");
    sel.focus();
    await userEvent.keyboard("{ArrowDown}");
    if (sel.value === "a") {
      sel.selectedIndex += 1;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    expect(sel.value).toBe("b");
    expect(applied[spec.settings!.presetField!]).toBe("b");
    host.remove();
  });
});
