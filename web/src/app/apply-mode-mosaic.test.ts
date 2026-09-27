import { beforeEach, describe, expect, it } from "vitest";
import {
  consentBlockMessage,
  mosaicFocusSlot,
  mosaicSwapFrom,
  revertModeSelection,
} from "./apply-mode-mosaic";

describe("mosaicFocusSlot", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("falls back when focus is stale after a tile close", () => {
    const mosaic = {
      tileIds: ["plugin:talkers", "plugin:wifi"],
      focusedId: "plugin:topology",
    };
    expect(mosaicFocusSlot(mosaic)).toBe("plugin:talkers");
    expect(mosaicSwapFrom(mosaic, "plugin:heat")).toBe("plugin:talkers");
  });

  it("keeps a valid focus id on the wall", () => {
    const mosaic = {
      tileIds: ["plugin:talkers", "plugin:wifi"],
      focusedId: "plugin:wifi",
    };
    expect(mosaicFocusSlot(mosaic)).toBe("plugin:wifi");
  });
});

describe("revertModeSelection", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

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
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("names the plugin when available", () => {
    const msg = consentBlockMessage({ name: "Heat map" });
    expect(msg.includes("\u2192")).toBe(true);
    expect(msg === "Not approved yet. Heat map: Approve it in Settings → Plugins.").toBe(true);
  });

  it("uses generic copy when the plugin name is unknown", () => {
    const msg = consentBlockMessage(null);
    expect(msg.includes("\u2192")).toBe(true);
    expect(msg === "Not approved yet. Approve it in Settings → Plugins.").toBe(true);
  });

  it("includes unicode arrow in Settings Plugins consent copy", () => {
    const msg = consentBlockMessage({ name: "Heat map" });
    expect(msg.includes("\u2192")).toBe(true);
    expect(msg.includes("Settings \u2192 Plugins.")).toBe(true);
  });
});
