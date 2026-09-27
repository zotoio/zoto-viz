import { describe, expect, it } from "vitest";
import {
  consentBlockMessage,
  mosaicFocusSlot,
  mosaicSwapFrom,
  revertModeSelection,
} from "./apply-mode-mosaic";

describe("mosaicFocusSlot", () => {
  it("falls back when focus is stale after a tile close", () => {
    const mosaic = {
      tileIds: ["plugin:talkers", "plugin:wifi"],
      focusedId: "plugin:topology",
      mainTileId: "",
    };
    expect(mosaicFocusSlot(mosaic)).toBe("plugin:talkers");
    expect(mosaicSwapFrom(mosaic, "plugin:heat")).toBe("plugin:talkers");
  });

  it("prefers the main tile over the first slot when focus is stale", () => {
    const mosaic = {
      tileIds: ["plugin:talkers", "plugin:wifi", "plugin:heat"],
      focusedId: "plugin:topology",
      mainTileId: "plugin:wifi",
    };
    expect(mosaicFocusSlot(mosaic)).toBe("plugin:wifi");
    expect(mosaicSwapFrom(mosaic, "plugin:memory")).toBe("plugin:wifi");
  });

  it("keeps a valid focus id on the wall", () => {
    const mosaic = {
      tileIds: ["plugin:talkers", "plugin:wifi"],
      focusedId: "plugin:wifi",
      mainTileId: "plugin:talkers",
    };
    expect(mosaicFocusSlot(mosaic)).toBe("plugin:wifi");
  });
});

describe("revertModeSelection", () => {
  it("restores header mode and liveMode", () => {
    const modeSel = { value: "plugin:heat" };
    const live = { mode: "plugin:heat" };
    revertModeSelection("plugin:topology", modeSel, live, "test.mode");
    expect(modeSel.value).toBe("plugin:topology");
    expect(live.mode).toBe("plugin:topology");
    expect(localStorage.getItem("test.mode")).toBe("plugin:topology");
  });
});

describe("consentBlockMessage", () => {
  it("names the plugin when available", () => {
    expect(consentBlockMessage({ name: "Heat map" })).toMatch(/Heat map.*Settings → Plugins/);
    expect(consentBlockMessage(null)).toMatch(/Not approved yet.*Settings → Plugins/);
  });
});
