import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPluginModes, talkers, topology } from "../core/modes";
import {
  applyMosaicViewPick,
  fillMosaicViewSelect,
  mosaicViewOptionLabel,
  pickMosaicViewForSlot,
} from "./mosaic-view-pick";
import { parseMosaicTiles } from "../graph/mosaic-layout";
import { Settings } from "./settings";
import { DEFAULT_DREAM } from "../graph/scene";

describe("mosaic view pick", () => {
  beforeEach(() => {
    setPluginModes([
      { ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" },
      { ...talkers, id: "plugin:talkers", pluginId: "talkers", label: "Talkers" },
    ]);
  });

  afterEach(() => setPluginModes([]));

  it("labels options for views already on the wall", () => {
    const tiles = ["plugin:topology", "plugin:talkers"];
    expect(mosaicViewOptionLabel("plugin:topology", tiles)).toMatch(/On tile 1/);
    const sel = document.createElement("select");
    fillMosaicViewSelect(sel, "plugin:talkers", tiles);
    const topo = [...sel.options].find((o) => o.value === "plugin:topology");
    expect(topo?.textContent).toMatch(/On tile 1/);
  });

  it("adds another tile slot for a duplicate pack", () => {
    const tiles = ["plugin:topology", "plugin:talkers"];
    const next = applyMosaicViewPick(tiles, "plugin:talkers", "plugin:topology", { kind: "add" });
    expect(next).toEqual(["plugin:topology", "plugin:topology!1"]);
  });

  it("moves a view between tiles when requested", () => {
    const tiles = ["plugin:topology", "plugin:talkers"];
    const next = applyMosaicViewPick(tiles, "plugin:talkers", "plugin:topology", { kind: "move", tileIndex: 1 });
    expect(next).toEqual(["plugin:talkers", "plugin:topology"]);
  });

  it("persists duplicate tile slots across settings round-trip", async () => {
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-dup", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...DEFAULT_DREAM,
      ...s.animSettings,
      mosaic: "2",
      mosaicTiles: ["plugin:topology", "plugin:topology!1"],
    });
    const raw = localStorage.getItem("zoto-viz-mosaic-dup.anim.mosaicTiles");
    expect(JSON.parse(raw!)).toEqual(["plugin:topology", "plugin:topology!1"]);
    expect(parseMosaicTiles(s.animSettings.mosaicTiles)).toEqual(["plugin:topology", "plugin:topology!1"]);
  });

  it("returns null when the duplicate dialog is cancelled", async () => {
    const tiles = ["plugin:topology", "plugin:talkers"];
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      const el = node as HTMLElement;
      if (el.className === "mosaic-pick-backdrop") {
        el.querySelector<HTMLButtonElement>(".link")?.click();
      }
      return el;
    });
    const next = await pickMosaicViewForSlot(tiles, "plugin:talkers", "plugin:topology");
    expect(next).toBeNull();
    vi.restoreAllMocks();
  });
});
