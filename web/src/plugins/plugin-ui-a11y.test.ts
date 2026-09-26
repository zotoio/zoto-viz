import { describe, expect, it } from "vitest";
import { loadSettingsDeclFixture } from "./fixtures/load-settings-fixture";
import { fillPluginFields } from "./plugin-ui";

describe("plugin settings a11y", () => {
  it("keeps aria-live announcer across toolbar remount", () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const host = document.createElement("div");
    document.body.append(host);
    fillPluginFields(host, spec, fields, () => {});
    const announcer = host.querySelector(".plugin-settings-announcer");
    expect(announcer).toBeTruthy();
    const randomise = host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]');
    randomise?.click();
    expect(host.querySelector(".plugin-settings-announcer")).toBe(announcer);
    expect(announcer?.textContent).toBe("Randomised");
  });

  it("restores focus to the toolbar button after randomise", () => {
    const spec = loadSettingsDeclFixture();
    const host = document.createElement("div");
    document.body.append(host);
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const randomise = host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]');
    randomise?.focus();
    randomise?.click();
    expect(document.activeElement).toBe(host.querySelector('[data-toolbar-action="randomise"]'));
  });
});
