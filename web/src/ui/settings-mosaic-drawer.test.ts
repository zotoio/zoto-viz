import { describe, expect, it } from "vitest";
import { Settings } from "./settings";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";
import { DEFAULT_DREAM, MOSAIC_SIZES } from "../graph/scene";

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

  it("a bad stored mosaic size quietly falls back to the default layout, and the control shows it (UX Pro)", () => {
    const inUse = MOSAIC_SIZES.find((o) => o.value === DEFAULT_DREAM.mosaic)!.label;
    for (const raw of ["7", "", "junk", "2"]) {
      const prefix = `zoto-mosaic-stored-${raw || "empty"}`;
      localStorage.setItem(`${prefix}.anim.mosaic`, raw); // the real storage path: Settings reads it at construction
      const s = new Settings({ storePrefix: prefix, onChange: () => {} });
      expect(s.animSettings.mosaic, `stored ${JSON.stringify(raw)}`).toBe(DEFAULT_DREAM.mosaic);
      s.addAnimation(() => {}, { el: document.createElement("div") });
      s.open("view");
      const labels = MOSAIC_SIZES.map((o) => o.label).join("|");
      const sizeRows = [...s.el.querySelectorAll<HTMLElement>(".skypick")]
        .filter((row) => [...row.querySelectorAll("button.sky")].map((b) => b.textContent).join("|") === labels);
      expect(sizeRows).toHaveLength(1);
      const sizeChips = [...sizeRows[0]!.querySelectorAll<HTMLButtonElement>("button.sky")];
      const pressed = sizeChips.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
      expect(pressed, `stored ${JSON.stringify(raw)}`).toEqual([inUse]);
      // The default is one full-screen view: no tile pickers, so no blank tiles; and no error copy.
      expect(s.el.querySelectorAll(".mosaic-slot").length).toBe(0);
      expect(s.el.querySelector("[role=alert]")).toBeNull();
      localStorage.removeItem(`${prefix}.anim.mosaic`);
    }
  });
});
