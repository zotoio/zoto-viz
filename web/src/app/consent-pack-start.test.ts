import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes, talkers, topology } from "../core/modes";
import { Settings } from "../ui/settings";
import { DEFAULT_DREAM } from "../graph/scene";
import { consentBlockMessage } from "./apply-mode-mosaic";
import { reconcileMosaicTilesWithMode, resolveRestoredViewMode } from "./boot-view-restore";
import { pickMosaicPaneWith } from "./mosaic-pane-pick";
import { wireSettingsMosaicPanePick } from "./mosaic-pane-pick-wire";
import {
  resetPaneSwitchTokens,
  switchPaneView,
  type SwitchPaneViewHost,
} from "./switch-pane-view";

const HEAT_NOTICE = "Heat map isn't approved yet. Approve it in Settings → Plugins.";

function host(over: Partial<SwitchPaneViewHost> & Pick<SwitchPaneViewHost, "tileIds">): SwitchPaneViewHost {
  return {
    focusedId: null,
    setPaneView: vi.fn(() => true),
    setPaneNotice: vi.fn(),
    focus: vi.fn(),
    ...over,
  };
}

describe("consent blocks pack start paths", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:heat", pluginId: "heat", label: "Heat map" },
      { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
  });

  afterEach(() => {
    resetPaneSwitchTokens();
    setPluginModes([]);
  });

  it("header mode pick shows consent notice and does not mount", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const mountView = vi.fn();
    const result = await switchPaneView(m, "plugin:heat", {
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(mountView).toHaveBeenCalledTimes(0);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const call = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1] === HEAT_NOTICE).toBe(true);
    expect(call[1] === consentBlockMessage({ name: "Heat map" })).toBe(true);
  });

  it("tile chrome pick shows consent notice and does not mount", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const mountView = vi.fn();
    const result = await switchPaneView(m, "plugin:heat", {
      fromViewId: "plugin:topology",
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(mountView).toHaveBeenCalledTimes(0);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const call = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1] === HEAT_NOTICE).toBe(true);
  });

  it("settings wall slot pick calls switchPaneView once and shows consent notice", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
    });
    const mountView = vi.fn();
    let switchCalls = 0;
    const s = new Settings({ storePrefix: "zoto-viz-consent-slot", onChange: () => {} });
    wireSettingsMosaicPanePick(s, (from, to) =>
      pickMosaicPaneWith(
        {
          runSwitch: async (toViewId, fromViewId) => {
            switchCalls += 1;
            return switchPaneView(m, toViewId, {
              fromViewId,
              ensureReviewed: async () => false,
              spec: { name: "Heat map" },
              pluginId: "heat",
              teardownView: vi.fn(),
              mountView,
              persistLayout: vi.fn(),
            });
          },
          refreshMosaicSlots: () => {},
        },
        from,
        to,
      ),
    );
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...DEFAULT_DREAM,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:wifi"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    sel!.value = "plugin:heat";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(switchCalls).toBe(1);
    expect(mountView).toHaveBeenCalledTimes(0);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const call = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1] === HEAT_NOTICE).toBe(true);
  });

  it("boot reconcile then switch shows consent notice and does not mount", async () => {
    const tiles = ["plugin:topology", "plugin:wifi"];
    const mode = resolveRestoredViewMode({
      localMode: "plugin:heat",
      fallback: "plugin:topology",
    });
    const restored = reconcileMosaicTilesWithMode(tiles, mode, "plugin:topology");
    expect(restored[0]).toBe("plugin:heat");
    const m = host({ tileIds: restored, focusedId: "plugin:heat" });
    const mountView = vi.fn();
    const result = await switchPaneView(m, "plugin:heat", {
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(mountView).toHaveBeenCalledTimes(0);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const call = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1] === HEAT_NOTICE).toBe(true);
  });

  it("reload header pick shows consent notice and does not mount", async () => {
    const m = host({
      tileIds: ["plugin:topology", "plugin:wifi", "plugin:kefrens", "plugin:talkers"],
      focusedId: "plugin:kefrens",
    });
    const mountView = vi.fn();
    const result = await switchPaneView(m, "plugin:heat", {
      ensureReviewed: async () => false,
      spec: { name: "Heat map" },
      pluginId: "heat",
      teardownView: vi.fn(),
      mountView,
      persistLayout: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(mountView).toHaveBeenCalledTimes(0);
    expect(m.setPaneNotice).toHaveBeenCalledTimes(1);
    const call = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1] === HEAT_NOTICE).toBe(true);
  });
});
