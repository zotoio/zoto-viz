import { describe, expect, it } from "vitest";
import type { PluginView } from "./plugin";
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

  it("shows a visible dirty marker that clears on reset", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const gainWrap = host.querySelector<HTMLElement>('[data-field-key="gain"]')!;
    const range = gainWrap.querySelector<HTMLInputElement>('input[type="range"]')!;
    range!.value = "8";
    range!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(gainWrap.classList.contains("field-dirty")).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-toolbar-action="reset"]')!.click();
    expect(host.querySelector('[data-field-key="gain"]')?.classList.contains("field-dirty")).toBe(false);
  });

  it("marks text fields dirty on input", () => {
    const spec: PluginView = {
      id: "text-dirty",
      name: "Text",
      version: 1,
      config: [{ key: "gateway", label: "gw", type: "text", default: "ours" }],
    };
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config!, () => {});
    const wrap = host.querySelector<HTMLElement>('[data-field-key="gateway"]');
    const input = wrap?.querySelector<HTMLInputElement>("input");
    input!.value = "192.168.1.2";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrap?.classList.contains("field-dirty")).toBe(true);
  });
});
