import { afterEach, describe, expect, it } from "vitest";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
  resetVizHudTileBudgetLineAllocCounter,
  vizHudTileBudgetLineObjectsCreated,
} from "../app/main-viz-tile-lines";
import { VizHud } from "./viz-hud";
import {
  resetVizTileBudgetLifecycle,
  syncVizTileScope,
  vizTileBudgetLifecycle,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";

describe("mosaic HUD lines and tile budgets F4", () => {
  afterEach(() => {
    vizTileBudgetRegistry.reset();
    resetVizTileBudgetLifecycle();
    resetVizHudTileBudgetLineAllocCounter();
    document.body.innerHTML = "";
  });

  it("F4: 600 steady frames → 0 budget/HUD line objects created", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    hud.setActive("packet-tunnel", "tunnel");
    syncVizTileScope(["main"]);
    hud.syncMosaicTileHudLines(["main"]);
    const tileIds = ["main"];
    mosaicTileBudgetLines(tileIds);
    resetVizHudTileBudgetLineAllocCounter();
    const createdBefore = vizTileBudgetLifecycle.created + vizHudTileBudgetLineObjectsCreated();
    for (let i = 0; i < 600; i++) {
      const lines = mosaicTileBudgetLines(tileIds)!;
      bindMosaicTileBudgetLines(lines, (id) => vizTileBudgetRegistry.getTile(id));
      hud.tick({
        packId: "packet-tunnel",
        packName: "tunnel",
        stats: { lastMs: 0, overBudget: 0, skipped: 0, total: i },
        frame: null,
        state: { ts: 0, stats: { active_flows: 0, devices: 0, packets: 0 }, devices: [], flows: [], sources: [], plugin_state: {} },
        now: i / 60,
        tileBudgetLines: lines,
      });
    }
    const createdAfter = vizTileBudgetLifecycle.created + vizHudTileBudgetLineObjectsCreated();
    expect(createdAfter - createdBefore).toBe(0);
  });

  it("F4: 1×1 to 2×2 rebuild creates 4; back to 1×1 releases 3", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    vizTileBudgetRegistry.reset();
    resetVizTileBudgetLifecycle();
    hud.mosaicHudLinesCreated = 0;
    hud.mosaicHudLinesReleased = 0;

    syncVizTileScope(["a"]);
    hud.syncMosaicTileHudLines(["a"]);

    const tiles = ["a", "b", "c", "d"];
    syncVizTileScope(tiles);
    hud.syncMosaicTileHudLines(tiles);
    expect(vizTileBudgetLifecycle.created).toBe(4);
    expect(hud.mosaicHudLinesCreated).toBe(4);

    syncVizTileScope(["a"]);
    hud.syncMosaicTileHudLines(["a"]);
    expect(vizTileBudgetLifecycle.released).toBe(3);
    expect(hud.mosaicHudLinesReleased).toBe(3);
  });
});
