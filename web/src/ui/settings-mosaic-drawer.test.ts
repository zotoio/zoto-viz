import { describe, expect, it } from "vitest";
import { Settings } from "./settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";

describe("mosaic layout vs settings drawer", () => {
  it("keeps This view open after switching to 2×2 and restores gear focus after Esc", () => {
    const s = new Settings({ storePrefix: "zoto-mosaic-drawer", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    const spec = loadSettingsDeclFixture();
    s.bindView(spec, spec.config);
    const host = document.createElement("div");
    document.body.append(host);
    const cog = s.attachViewCog(host);
    cog.click();
    expect(s.isOpen).toBe(true);
    expect(s.activePaneId).toBe("view");

    s.applyAnim({ ...s.animSettings, mosaic: "4", mosaicTiles: ["plugin:topology", "plugin:memory", "plugin:disk", "plugin:gpu"] });
    s.reopenViewPane();
    expect(s.isOpen).toBe(true);
    expect(s.activePaneId).toBe("view");

    cog.focus();
    s.el.querySelector(".settings-pop")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(s.isOpen).toBe(false);
    expect(document.activeElement).toBe(cog);
    host.remove();
  });
});
