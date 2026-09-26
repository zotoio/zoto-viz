import { describe, expect, it, vi } from "vitest";
import {
  consentBlockMessage,
  mosaicFocusSlot,
  mosaicHeaderPreApply,
  mosaicPanePickPreApply,
  mosaicSwapFrom,
  revertModeSelection,
} from "./apply-mode-mosaic";

describe("mosaicFocusSlot", () => {
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
    expect(consentBlockMessage({ name: "Heat map" })).toMatch(/Heat map needs review/);
  });
});

describe("mosaicHeaderPreApply", () => {
  it("denies before swapping the pane and paints the target slot", async () => {
    const setPaneView = vi.fn(() => true);
    const notices: [string, string][] = [];
    const mosaic = {
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:wifi",
      setPaneView,
      setPaneNotice: (id: string, text: string | null) => {
        if (text) notices.push([id, text]);
      },
    };
    const result = await mosaicHeaderPreApply(
      mosaic,
      "plugin:heat",
      async () => false,
      { name: "Heat" },
    );
    expect(result).toBe("denied");
    expect(setPaneView).not.toHaveBeenCalled();
    expect(notices).toEqual([["plugin:wifi", consentBlockMessage({ name: "Heat" })]]);
  });
});

describe("mosaicPanePickPreApply", () => {
  it("denies before swapping the pane and paints the slot", async () => {
    const setPaneView = vi.fn(() => true);
    const notices: [string, string][] = [];
    const mosaic = {
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
      setPaneView,
      setPaneNotice: (id: string, text: string | null) => {
        if (text) notices.push([id, text]);
      },
    };
    const result = await mosaicPanePickPreApply(
      mosaic,
      "plugin:topology",
      "plugin:heat",
      async () => false,
      { name: "Heat" },
    );
    expect(result).toBe("denied");
    expect(setPaneView).not.toHaveBeenCalled();
    expect(notices[0]?.[0]).toBe("plugin:topology");
  });
});
