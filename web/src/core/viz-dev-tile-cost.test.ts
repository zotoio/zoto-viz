import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors, vizBuildCostTicks } from "./viz-clock";
import {
  devTileCostWallBuildReads,
  readDevTileCostOnWallBuild,
  resetDevTileCostForTests,
} from "./viz-dev-tile-cost";
import { createTileHudLabelLine } from "../ui/tile-hud-label";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";

describe("dev vizTileCostTicks flag", () => {
  afterEach(() => {
    resetDevTileCostForTests();
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("F4 dev: flag off — 600 frames, 0 injected cost, no LIMITED at 1×1", () => {
    readDevTileCostOnWallBuild("");
    expect(devTileCostWallBuildReads()).toBe(1);
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
      if (vizBuildCostTicks(i) !== undefined) injected++;
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

  it("F4 dev: flag read once per wall build, not per frame", () => {
    resetDevTileCostForTests();
    readDevTileCostOnWallBuild("?vizTileCostTicks=99999");
    readDevTileCostOnWallBuild("?vizTileCostTicks=99999");
    expect(devTileCostWallBuildReads()).toBe(2);
    expect(vizBuildCostTicks(0)).toBe(99999);
  });
});
