import { afterEach, describe, expect, it } from "vitest";
import { mosaicWallLayoutRefusedMessage } from "./viz-copy";
import { Settings } from "./settings";

describe("mosaic viz tile guard H6", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("H6 boot: nine tiles in localStorage refused on Settings construct", () => {
    const prefix = "zoto-viz-h6-boot";
    const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    localStorage.setItem(`${prefix}.anim.mosaic`, "8");
    localStorage.setItem(`${prefix}.anim.mosaicTiles`, JSON.stringify(nine));
    const s = new Settings({ storePrefix: prefix, onChange: () => {} });
    expect(s.lastMosaicTileLimitMessage).toBe(mosaicWallLayoutRefusedMessage(9, 8));
    const status = s.el.querySelector<HTMLElement>(".mosaic-wall-status");
    expect(status?.hidden).toBe(false);
    expect(s.animSettings.mosaicTiles.length).toBeLessThan(9);
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
