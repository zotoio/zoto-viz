import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onMosaicSwitchConsentDenied } from "./mosaic-switch-consent";
import { setPreserveVizUbo, peekPreserveVizUbo } from "./viz-ubo-preserve";
import { resetPaneSwitchTokens, switchPaneView } from "./switch-pane-view";

describe("consent deny clears viz UBO preserve", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPreserveVizUbo(true);
  });

  afterEach(() => {
    setPreserveVizUbo(false);
    resetPaneSwitchTokens();
  });

  it("clears preserveVizUbo after consent deny on switchPaneView", async () => {
    const m = {
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
      setPaneView: vi.fn(() => true),
      setPaneNotice: vi.fn(),
      focus: vi.fn(),
    };
    await switchPaneView(m, "plugin:heat", {
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView: vi.fn(),
      persistLayout: vi.fn(),
      onConsentDenied: onMosaicSwitchConsentDenied,
    });
    expect(peekPreserveVizUbo()).toBe(false);
  });
});
