import { describe, expect, it } from "vitest";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields } from "./plugin-ui";

describe("plugin settings dirty markers", () => {
  it("marks a slider row dirty on input without rebuilding the panel", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    document.body.append(host);
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const childCount = host.childElementCount;
    const gainWrap = host.querySelector<HTMLElement>('[data-field-key="gain"]');
    const slider = gainWrap?.querySelector("label.slider");
    const range = gainWrap?.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).toBeTruthy();
    expect(gainWrap?.classList.contains("field-dirty")).toBe(false);

    range!.value = "5";
    range!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(host.childElementCount).toBe(childCount);
    expect(gainWrap?.classList.contains("field-dirty")).toBe(true);
    expect(gainWrap?.querySelector("label.slider")).toBe(slider);
    host.remove();
  });
});
