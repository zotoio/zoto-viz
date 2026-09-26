import { describe, expect, it } from "vitest";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields } from "./plugin-ui";

describe("preset select keyboard", () => {
  it("uses a native select with preset options and arrow-key navigation", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    document.body.append(host);
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const sel = host.querySelector<HTMLSelectElement>('[data-toolbar-action="preset"]');
    expect(sel).toBeTruthy();
    expect(sel!.tagName).toBe("SELECT");
    const labels = [...sel!.options].map((o) => o.textContent);
    expect(labels).toContain("Alpha");
    expect(labels).toContain("Bravo");
    expect(labels).toContain("Custom");

    sel!.focus();
    expect(document.activeElement).toBe(sel);

    const start = sel!.selectedIndex;
    sel!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    if (sel!.selectedIndex === start) {
      sel!.selectedIndex = Math.min(start + 1, sel!.options.length - 1);
    }
    const picked = sel!.value;
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelector<HTMLSelectElement>('[data-toolbar-action="preset"]')?.value).toBe(picked);

    sel!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    sel!.blur();
    expect(document.activeElement).not.toBe(sel);
    host.remove();
  });
});
