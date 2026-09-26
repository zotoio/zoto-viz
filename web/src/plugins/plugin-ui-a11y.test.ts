import { describe, expect, it, vi } from "vitest";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { configStoreId } from "./instances";
import { clearUndoRing, undoRingDepth } from "./plugin-settings";
import { fillPluginFields } from "./plugin-ui";

function mountPanel() {
  const wrap = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(wrap);
  wrap.append(host);
  return { wrap, host };
}

describe("plugin settings a11y", () => {
  it("keeps aria-live announcer outside the rebuilt host subtree", async () => {
    const spec = loadSettingsDeclFixture();
    const { wrap, host } = mountPanel();
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const announcer = wrap.querySelector(".plugin-settings-announcer");
    expect(announcer).toBeTruthy();
    expect(host.contains(announcer)).toBe(false);
    host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]')?.click();
    await vi.waitFor(() => expect(announcer?.textContent).toBe("Randomised"));
    expect(wrap.querySelector(".plugin-settings-announcer")).toBe(announcer);
    host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]')?.click();
    await vi.waitFor(() => expect(announcer?.textContent).toBe("Randomised"));
  });

  it("restores focus to the toolbar button after randomise", () => {
    const spec = loadSettingsDeclFixture();
    const { host } = mountPanel();
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const randomise = host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]');
    randomise?.focus();
    randomise?.click();
    expect(document.activeElement).toBe(host.querySelector('[data-toolbar-action="randomise"]'));
  });

  it("restores focus to preset select after preset pick", async () => {
    const spec = loadSettingsDeclFixture();
    const { host } = mountPanel();
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    expect(host.querySelector('[data-toolbar-action="preset"]')).toBeTruthy();
    const presetBtn = host.querySelector<HTMLButtonElement>('[data-toolbar-action="preset"] button');
    presetBtn?.focus();
    presetBtn?.click();
    const option = [...host.querySelectorAll<HTMLLIElement>("[role=option]")].find((o) => o.textContent?.includes("Bravo"));
    option?.click();
    await vi.waitFor(() => {
      const btn = host.querySelector<HTMLButtonElement>('[data-toolbar-action="preset"] button');
      expect(document.activeElement === btn || btn?.contains(document.activeElement)).toBe(true);
    });
  });

  it("falls back to randomise when undo empties the ring", () => {
    const spec = loadSettingsDeclFixture();
    clearUndoRing(configStoreId(spec));
    const { host } = mountPanel();
    fillPluginFields(host, spec, spec.config ?? [], () => {});
    const randomise = host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]');
    const undo = host.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]');
    randomise?.click();
    expect(undo?.disabled).toBe(false);
    undo?.click();
    expect(undoRingDepth(configStoreId(spec))).toBe(0);
    const undoAfter = host.querySelector<HTMLButtonElement>('[data-toolbar-action="undo"]');
    expect(undoAfter?.disabled).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[data-toolbar-action="randomise"]'));
  });
});
