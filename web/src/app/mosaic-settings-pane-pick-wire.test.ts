import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { setPluginModes, talkers, topology } from "../core/modes";
import { Settings } from "../ui/settings";
import { pickMosaicPaneWith } from "./mosaic-pane-pick";
import { wireSettingsMosaicPanePick } from "./mosaic-pane-pick-wire";
import { switchPaneView } from "./switch-pane-view";

const HEAT_NOTICE = "Heat map isn't approved yet. Approve it in Settings → Plugins.";

describe("settings mosaic pane pick wire", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:heat", pluginId: "heat", label: "Heat map" },
      { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
  });

  it("routes wall slot picks through switchPaneView and consent notice", async () => {
    const m = {
      tileIds: ["plugin:topology", "plugin:wifi"],
      focusedId: "plugin:topology",
      setPaneView: vi.fn(() => true),
      setPaneNotice: vi.fn(),
      focus: vi.fn(),
    };
    const mountView = vi.fn();
    let switchCalls = 0;
    const s = new Settings({ storePrefix: "zoto-viz-wire-regression", onChange: () => {} });
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
    const notice = (m.setPaneNotice as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(notice === HEAT_NOTICE).toBe(true);
  });
});
