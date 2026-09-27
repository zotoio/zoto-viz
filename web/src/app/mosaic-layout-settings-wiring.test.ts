import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { Settings } from "../ui/settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { applyMosaicLayoutFromAnim } from "./mosaic-layout-settings-wiring";

describe("main mosaic layout wiring > settings drawer", () => {
  beforeEach(() => localStorage.clear());

  function settingsHost(s: Settings) {
    return {
      get isOpen() { return s.isOpen; },
      get activePaneId() { return s.activePaneId; },
      get viewFocus() { return s.viewFocus; },
      prepareMosaicLayoutChange: (tiles: string[]) => s.prepareMosaicLayoutChange(tiles),
      consumePreserveViewBind: () => s.consumePreserveViewBind(),
    };
  }

  function mosaicFake(layoutKey: string) {
    return {
      layoutKey,
      mainMode: "plugin:topology",
      focusedId: "plugin:topology",
      tileIds: ["plugin:topology"],
      setSize: vi.fn(),
    };
  }

  it("1×1 to 2×2 with unsaved edit keeps drawer open and focus inside", () => {
    const s = new Settings({ storePrefix: "zoto-layout-drawer-a", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    const spec = loadSettingsDeclFixture();
    document.body.append(s.el);
    const cog = s.attachViewCog(document.createElement("div"));
    cog.click();
    s.bindView(spec, spec.config);
    const gain = s.el.querySelector<HTMLInputElement>('[data-field-key="gain"] input[type="range"]')!;
    gain.value = "8";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    gain.focus();
    expect(s.hasViewEdits()).toBe(true);

    const mosaic = mosaicFake("off:off:plugin:topology:");
    const anim = {
      ...DEFAULT_DREAM,
      mosaic: "4" as const,
      mosaicTiles: ["plugin:topology", "plugin:memory", "plugin:disk", "plugin:gpu"],
    };
    applyMosaicLayoutFromAnim(mosaic as never, anim, settingsHost(s), {
      layoutKey: mosaic.layoutKey,
      stopArcadeIfNeeded: () => {},
      onBeforeSetSize: () => {},
      onAfterSetSize: () => {},
    });
    expect(mosaic.setSize).toHaveBeenCalled();
    expect(s.isOpen).toBe(true);
    expect(s.activePaneId).toBe("view");
    expect(s.consumePreserveViewBind()).toBe(true);
    const drawer = document.querySelector(".settings-pop");
    expect(drawer?.contains(document.activeElement as Node)).toBe(true);
    expect(gain.value).toBe("8");
    s.el.remove();
  });

  it("removing the focused tile with unsaved edits prompts discard then closes", () => {
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    const s = new Settings({ storePrefix: "zoto-layout-drawer-b", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    const spec = loadSettingsDeclFixture();
    document.body.append(s.el);
    s.bindView(spec, spec.config);
    s.openView("plugin:topology");
    const gain = s.el.querySelector<HTMLInputElement>('[data-field-key="gain"] input[type="range"]')!;
    gain.value = "8";
    gain.dispatchEvent(new Event("input", { bubbles: true }));

    const mosaic = mosaicFake("2:off:plugin:topology,plugin:memory:");
    const anim = {
      ...DEFAULT_DREAM,
      mosaic: "2" as const,
      mosaicTiles: ["plugin:memory", "plugin:disk"],
    };
    applyMosaicLayoutFromAnim(mosaic as never, anim, settingsHost(s), {
      layoutKey: mosaic.layoutKey,
      stopArcadeIfNeeded: () => {},
      onBeforeSetSize: () => {},
      onAfterSetSize: () => {},
    });
    expect(confirm).toHaveBeenCalled();
    expect(s.isOpen).toBe(false);
    window.confirm = () => true;
    s.el.remove();
  });
});
