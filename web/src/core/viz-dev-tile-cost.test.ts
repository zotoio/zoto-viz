import { afterEach, describe, expect, it, vi } from "vitest";
import { resetVizClockInjectors, vizBuildCostTicksForTile } from "./viz-clock";
import { readDevTileCostOnWallBuild } from "./viz-dev-tile-cost";
import { createTileHudLabelLine } from "../ui/tile-hud-label";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";

describe("dev vizTileCostTicks flag", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
    vi.unstubAllEnvs();
  });

  it("F4 dev: flag off — 600 frames, 0 injected cost, no LIMITED at 1×1", () => {
    vi.stubEnv("DEV", true);
    readDevTileCostOnWallBuild("", ["main"]);
    syncVizTileScope(["main"]);
    const budget = new VizFrameBudget(() => 0, "main");
    const state = fatLanFixture();
    let injected = 0;
    for (let i = 0; i < 600; i++) {
      budget.deliver(state, monoMs(0), 0, () => {}, (s, pt, a) => ({
        t: 0,
        dt: 0,
        audio: a,
        packets: [],
        rf: [],
        talkers: [],
        headlines: [],
      }));
      if (vizBuildCostTicksForTile("main", i) !== undefined) injected++;
    }
    expect(injected).toBe(0);
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    for (let frame = 0; frame < 600; frame++) {
      const text = line.limitedLabel(1, 0);
      if (text) line.writeText(el, text);
    }
    expect(line.stats.builds).toBe(0);
    expect(el.textContent).toBe("");
  });

  it("F4 dev: per-tile index — only tile 0 skips at 2×2", () => {
    vi.stubEnv("DEV", true);
    const tiles = tileIdsForLayout(2, 2);
    readDevTileCostOnWallBuild("?vizTileCostTicks=0:99999", tiles);
    syncVizTileScope(tiles);
    const state = fatLanFixture();
    const budgets = tiles.map((id) => new VizFrameBudget(() => 0, id));
    for (let i = 0; i < 120; i++) {
      for (const budget of budgets) {
        budget.deliver(state, monoMs(0), 0, () => {}, () => ({
          t: 1,
          dt: 0,
          audio: 0,
          packets: [],
          rf: [],
          talkers: [],
          headlines: [],
        }));
      }
      vizTileBudgetRegistry.advanceTick();
    }
    expect(vizTileBudgetRegistry.getTile("t0").skipped).toBeGreaterThan(0);
    expect(vizTileBudgetRegistry.getTile("t1").skipped).toBe(0);
    expect(vizBuildCostTicksForTile("t0", 0)).toBe(99999);
    expect(vizBuildCostTicksForTile("t1", 0)).toBeUndefined();
  });
});
