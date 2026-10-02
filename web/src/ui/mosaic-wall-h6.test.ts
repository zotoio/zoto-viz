import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { ProfileStore, shippedSettings } from "../core/profiles";
import { mosaicWallLayoutBootRefusedMessage } from "./viz-copy";
import { Settings } from "./settings";

const MOSAIC_TILE_LIMIT_SNIPPET = "17 tiles and the limit is 16";
const SEVENTEEN = "abcdefghijklmnopq".split("");

describe("mosaic viz tile guard H6", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Q1 H6 boot: nine saved tiles survive constructor, profiles.boot applyAnim, and persistAnim (twice)", () => {
    const prefix = "zoto-viz-h6-boot";
    const raw = JSON.stringify(SEVENTEEN);
    localStorage.setItem(`${prefix}.anim.mosaic`, "8");
    localStorage.setItem(`${prefix}.anim.mosaicTiles`, raw);
    const bytesBefore = localStorage.getItem(`${prefix}.anim.mosaicTiles`);

    const bootMsg =
      "Couldn't load your saved wall layout. It has 17 tiles and the limit is 16, so the default view is showing.";
    expect(mosaicWallLayoutBootRefusedMessage(17, 16).includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    expect(bootMsg.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);

    const profileAnim = shippedSettings().anim;

    for (let pass = 0; pass < 2; pass++) {
      const s = new Settings({ storePrefix: prefix, onChange: () => {} });
      expect(s.bootRefusedMosaicTilesRaw()).toBe(raw);
      expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);
      s.applyAnim(profileAnim);
      expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);
      expect(s.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
      const status = s.el.querySelector<HTMLElement>(".mosaic-wall-status");
      expect(status?.hidden).toBe(false);
      expect(status?.textContent?.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
      expect(s.animSettings.mosaic).toBe("off");
      expect(s.animSettings.mosaicTiles).toEqual([]);
      expect(s.animSettings.mosaic).toBe(DEFAULT_DREAM.mosaic);
      s.applyAnim(profileAnim);
      expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);
      expect(s.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    }
  });

  it("A3 Shot 1: boot refusal visible on new tab, reload, and blocked /api/profiles; stored bytes unchanged", async () => {
    const prefix = "zoto-viz-h6-a3";
    const raw = JSON.stringify(SEVENTEEN);
    localStorage.setItem(`${prefix}.anim.mosaicTiles`, raw);
    const bytesBefore = localStorage.getItem(`${prefix}.anim.mosaicTiles`);
    expect(bytesBefore).toBe(raw);

    const bootMsg = mosaicWallLayoutBootRefusedMessage(17, 16);
    const profileAnim = shippedSettings().anim;

    const tab1 = new Settings({ storePrefix: prefix, onChange: () => {} });
    expect(tab1.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    expect(tab1.el.querySelector<HTMLElement>(".mosaic-wall-status")?.textContent?.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);

    const tab2 = new Settings({ storePrefix: prefix, onChange: () => {} });
    expect(tab2.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/profiles") && method === "GET") {
        throw new Error("profiles blocked");
      }
      return origFetch(input, init);
    }) as typeof fetch;

    const store = new ProfileStore(
      { collect: shippedSettings, apply: () => {} },
      { value: "", el: document.createElement("div"), setOptions() {} },
      document.createElement("div"),
      document.createElement("div"),
    );
    await store.boot();
    expect(store.available).toBe(false);

    const tab3 = new Settings({ storePrefix: prefix, onChange: () => {} });
    expect(tab3.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    tab3.applyAnim(profileAnim);
    expect(localStorage.getItem(`${prefix}.anim.mosaicTiles`)).toBe(bytesBefore);

    globalThis.fetch = origFetch;
  });

  it("H6: reload with nine mosaicTiles is refused; current anim unchanged", () => {
    const s = new Settings({ storePrefix: "zoto-viz-h6-visible", onChange: () => {} });
    const sixteen = "abcdefghijklmnop".split("");
    s.applyAnim({
      ...s.animSettings,
      mosaic: "8",
      mosaicTiles: sixteen,
    });
    expect(s.animSettings.mosaicTiles).toEqual(sixteen);

    s.applyAnim({
      ...s.animSettings,
      mosaic: "8",
      mosaicTiles: [...sixteen, "q"],
    });

    expect(s.lastMosaicTileLimitMessage.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    const status = s.el.querySelector<HTMLElement>(".mosaic-wall-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent?.includes(MOSAIC_TILE_LIMIT_SNIPPET)).toBe(true);
    expect(s.animSettings.mosaicTiles).toEqual(sixteen);
    expect(s.animSettings.mosaic).toBe("8");
  });
});
