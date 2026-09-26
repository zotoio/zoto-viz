import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VizHud } from "./viz-hud";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";

describe("VizHud steady DOM writes", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vizTileBudgetRegistry.reset();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("W4: 600 steady frames → 0 textContent/title writes after first paint", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    hud.setActive("packet-tunnel", "tunnel");
    syncVizTileScope(["main"]);
    const budget = new VizFrameBudget(() => 0, "main");
    const state = fatLanFixture();
    const frame = {
      t: 0,
      dt: 0,
      audio: 0,
      packets: [{ proto: 1, size: 64, field: 1 }],
      rf: [],
      talkers: [],
      headlines: [],
    };
    const labelSpy = vi.spyOn(HTMLElement.prototype, "textContent", "set");
    const titleSpy = vi.spyOn(HTMLElement.prototype, "title", "set");
    hud.tick({
      packId: "packet-tunnel",
      packName: "tunnel",
      stats: budget.stats,
      frame,
      state,
      now: 0,
      tileBudget: vizTileBudgetRegistry.getTile("main"),
      activeTiles: 1,
    });
    labelSpy.mockClear();
    titleSpy.mockClear();
    for (let i = 1; i < 600; i++) {
      hud.tick({
        packId: "packet-tunnel",
        packName: "tunnel",
        stats: budget.stats,
        frame,
        state,
        now: i / 60,
        tileBudget: vizTileBudgetRegistry.getTile("main"),
        activeTiles: 1,
      });
    }
    expect(labelSpy).not.toHaveBeenCalled();
    expect(titleSpy).not.toHaveBeenCalled();
  });
});
