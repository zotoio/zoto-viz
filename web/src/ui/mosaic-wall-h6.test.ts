import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { mosaicWallLayoutBootRefusedMessage, mosaicWallLayoutRefusedMessage } from "./viz-copy";
import { Settings } from "./settings";

describe("mosaic viz tile guard H6", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("H6 boot: nine saved tiles → default view, boot copy, storage byte-identical (reload twice)", () => {
    const prefix = "zoto-viz-h6-boot";
    const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const raw = JSON.stringify(nine);
    localStorage.setItem(`${prefix}.anim.mosaic`, "8");
    localStorage.setItem(`${prefix}.anim.mosaicTiles`, raw);

    const bootMsg =
      "Couldn't load your saved wall layout. It has 9 tiles and the limit is 8, so the default view is showing.";
    expect(mosaicWallLayoutBootRefusedMessage(9, 8)).toBe(bootMsg);

    for (let pass = 0; pass < 2; pass++) {
      const s = new Settings({ storePrefix: prefix, onChange: () => {} });
      expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(raw);
      expect(s.lastMosaicTileLimitMessage).toBe(bootMsg);
      const status = s.el.querySelector<HTMLElement>(".mosaic-wall-status");
      expect(status?.hidden).toBe(false);
      expect(status?.classList.contains("fail")).toBe(false);
      expect(status?.classList.contains("viz-hud-skip-fail")).toBe(false);
      expect(status?.textContent).toBe(bootMsg);
      expect(s.animSettings.mosaic).toBe("off");
      expect(s.animSettings.mosaicTiles).toEqual([]);
      expect(s.animSettings.mosaic).toBe(DEFAULT_DREAM.mosaic);
    }
  });

  it("H6: reload with nine mosaicTiles is refused; current anim unchanged", () => {
    const s = new Settings({ storePrefix: "zoto-viz-h6-visible", onChange: () => {} });
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
    s.applyAnim({
      ...s.animSettings,
      mosaic: "8",
      mosaicTiles: eight,
    });
    expect(s.animSettings.mosaicTiles).toEqual(eight);

    s.applyAnim({
      ...s.animSettings,
      mosaic: "8",
      mosaicTiles: [...eight, "i"],
    });

    expect(s.lastMosaicTileLimitMessage).toBe(
      "Couldn't load this wall layout. It has 9 tiles and the limit is 8, so your current wall is still showing.",
    );
    const status = s.el.querySelector<HTMLElement>(".mosaic-wall-status");
    expect(status).toBeTruthy();
    expect(status?.hidden).toBe(false);
    expect(status?.classList.contains("fail")).toBe(false);
    expect(status?.classList.contains("viz-hud-skip-fail")).toBe(false);
    expect(status?.textContent).toBe(mosaicWallLayoutRefusedMessage(9, 8));
    expect(status?.textContent).toBe(
      "Couldn't load this wall layout. It has 9 tiles and the limit is 8, so your current wall is still showing.",
    );
    expect(s.animSettings.mosaicTiles).toEqual(eight);
    expect(s.animSettings.mosaic).toBe("8");
  });
});
