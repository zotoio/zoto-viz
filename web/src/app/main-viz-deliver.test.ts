import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { monoMs } from "../core/viz-time";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { mainVizDeliver, mainVizBuildFrame } from "./viz-main-deliver";

describe("main.ts viz deliver path", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("M1: mainVizDeliver monotonic dt sequence [0,16,17,17,16] ms", () => {
    const clocksAtBuild = [16, 32, 49, 66, 82];
    let buildIdx = 0;
    setVizClockInjector(() => clocksAtBuild[buildIdx]);
    syncVizTileScope(["main"]);
    const budget = new VizFrameBudget(() => clocksAtBuild[buildIdx], "main");
    const state = fatLanFixture();
    let prevClockMs = monoMs(0);
    const dtsMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      buildIdx = i;
      const { frame, nextClockMs } = mainVizDeliver({
        budget,
        prevClockMs,
        state,
        audio: 0,
        buildFrame: (s, pt, a) => mainVizBuildFrame(s, pt, a),
        onFrame: () => {},
      });
      if (frame) dtsMs.push(Math.round(frame.dt * 1000));
      prevClockMs = nextClockMs;
    }
    expect(dtsMs).toEqual([0, 16, 17, 17, 16]);
  });
});
