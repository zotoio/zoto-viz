import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { mainVizDeliver, mainVizBuildFrame } from "./viz-main-deliver";

describe("main.ts viz deliver path", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("M1: mainVizDeliver advances monotonic clock — dt > 0 after first frame", () => {
    const step = 1000 / 60;
    let mono = 0;
    setVizClockInjector(() => mono);
    syncVizTileScope(["main"]);
    const budget = new VizFrameBudget(() => mono, "main");
    const state = fatLanFixture();
    let prevClockMs = 0;
    const dts: number[] = [];
    for (let i = 0; i < 120; i++) {
      mono += step;
      const { frame, nextClockMs } = mainVizDeliver({
        budget,
        prevClockMs,
        state,
        audio: 0,
        buildFrame: (s, pt, a) => mainVizBuildFrame(s, pt, a),
        onFrame: () => {},
      });
      if (frame) dts.push(frame.dt);
      prevClockMs = nextClockMs;
    }
    expect(dts.length).toBeGreaterThan(0);
    expect(dts[0]).toBe(0);
    expect(dts.slice(1).every((d) => d > 0)).toBe(true);
  });
});
