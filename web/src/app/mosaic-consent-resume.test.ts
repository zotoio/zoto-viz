import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAllConsentPending,
  hasConsentPending,
  listConsentPending,
} from "./consent-pending-panes";
import { resumePendingConsentPaneSwitches } from "./mosaic-consent-resume";
import {
  resetPaneSwitchTokens,
  switchPaneView,
  type SwitchPaneViewHost,
} from "./switch-pane-view";

function host(over: Partial<SwitchPaneViewHost> & Pick<SwitchPaneViewHost, "tileIds">): SwitchPaneViewHost {
  return {
    focusedId: null,
    setPaneView: vi.fn(() => true),
    setPaneNotice: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

describe("mosaic consent resume", () => {
  afterEach(() => {
    clearAllConsentPending();
    resetPaneSwitchTokens();
  });

  it("registers a pending tile pick when consent is denied", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    await switchPaneView(m, "plugin:heat", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView: vi.fn(),
      persistLayout: vi.fn(),
    });
    expect(hasConsentPending()).toBe(true);
    expect(listConsentPending()).toEqual([
      {
        paneId: "plugin:topology",
        toViewId: "plugin:heat",
        fromViewId: "plugin:topology",
        pluginId: "heat",
      },
    ]);
  });

  it("retries through switchPaneView when consent appears (external approve)", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    let consented = false;
    const mountView = vi.fn();
    await switchPaneView(m, "plugin:heat", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => consented,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(mountView).not.toHaveBeenCalled();
    expect(hasConsentPending()).toBe(true);

    consented = true;
    await resumePendingConsentPaneSwitches(
      (id) => id === "heat",
      (pending) =>
        switchPaneView(m, pending.toViewId, {
          fromViewId: pending.fromViewId,
          ensureReviewed: async () => consented,
          spec: { name: "Heat map" },
          pluginId: "heat",
          teardownView: vi.fn(),
          mountView,
          persistLayout: vi.fn(),
        }),
    );

    expect(mountView).toHaveBeenCalledWith("plugin:heat");
    expect(hasConsentPending()).toBe(false);
  });

  it("shows Settings → Plugins approval copy on the tile", async () => {
    const m = host({ tileIds: ["plugin:a"], focusedId: "plugin:a" });
    await switchPaneView(m, "plugin:b", {
      fromViewId: "plugin:a",
      ensureReviewed: async () => false,
      spec: { name: "Demo" },
      pluginId: "demo",
      teardownView: vi.fn(),
      mountView: vi.fn(),
      persistLayout: vi.fn(),
    });
    expect(m.setPaneNotice).toHaveBeenCalledWith(
      "plugin:a",
      expect.stringMatching(/Not approved yet.*Settings → Plugins/),
    );
  });
});

describe("grantPluginConsent then catalog refresh", () => {
  afterEach(() => {
    clearAllConsentPending();
    resetPaneSwitchTokens();
  });

  it("simulates POST /consent updating catalog before resume", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const catalog = new Map<string, { consent: string | null }>([
      ["heat", { consent: null }],
    ]);
    const mountView = vi.fn();

    const ensureForHeat = async () => {
      const row = catalog.get("heat");
      return !!row?.consent;
    };

    await switchPaneView(m, "plugin:heat", {
      fromViewId: "plugin:topology",
      ensureReviewed: ensureForHeat,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(hasConsentPending()).toBe(true);

    catalog.set("heat", { consent: "reviewed" });

    await resumePendingConsentPaneSwitches(
      (id) => !!catalog.get(id)?.consent,
      (pending) =>
        switchPaneView(m, pending.toViewId, {
          fromViewId: pending.fromViewId,
          ensureReviewed: ensureForHeat,
          spec: { name: "Heat map" },
          pluginId: "heat",
          teardownView: vi.fn(),
          mountView,
          persistLayout: vi.fn(),
        }),
    );

    expect(mountView).toHaveBeenCalledWith("plugin:heat");
  });
});
