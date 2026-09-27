import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./settings";
import { DEFAULT_DREAM } from "../graph/scene";
import { setPluginModes, talkers, topology } from "../core/modes";

describe("settings mosaic pane pickers", () => {
  beforeEach(() => {
    expect.hasAssertions();
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
      { ...topology, id: "plugin:wifi", pluginId: "wifi", label: "Wi-Fi" },
    ]);
  });

  afterEach(() => setPluginModes([]));

  it("delegates slot changes to the live wall hook and reverts on failure", async () => {
    const pick = vi.fn(async () => true);
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-pick", onChange: () => {} });
    s.onMosaicPanePick = pick;
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...s.animSettings,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:wifi"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    expect(sel).toBeTruthy();
    sel!.value = "plugin:talkers";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(pick).toHaveBeenCalledWith("plugin:topology", "plugin:talkers");
  });

  it("reverts the dropdown when the live hook denies consent", async () => {
    const pick = vi.fn(async () => false);
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-pick-deny", onChange: () => {} });
    s.onMosaicPanePick = pick;
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...s.animSettings,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:wifi"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    expect(sel).toBeTruthy();
    sel!.value = "plugin:talkers";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(sel!.value).toBe("plugin:topology");
  });

  it("persists mosaicTiles after a slot change when no live hook is wired", () => {
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-pick-persist", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...DEFAULT_DREAM,
      ...s.animSettings,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:wifi"],
    });
    s.open("view");
    const sel = s.el.querySelector<HTMLSelectElement>(".mosaic-slot");
    expect(sel).toBeTruthy();
    sel!.value = "plugin:talkers";
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(s.animSettings.mosaicTiles).toEqual(["plugin:talkers", "plugin:wifi"]);
    const raw = localStorage.getItem("zoto-viz-mosaic-pick-persist.anim.mosaicTiles");
    expect(JSON.parse(raw!)).toEqual(["plugin:talkers", "plugin:wifi"]);
  });
});
