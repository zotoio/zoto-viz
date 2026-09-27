import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetVizClockInjectors,
  setVizClockInjector,
  setVizWallClockInjector,
} from "../core/viz-clock"
import { monoMs } from "../core/viz-time";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  DOGFOOD_SOAK_PATTERN_EXPECTED,
  runDogfoodSoak,
} from "./dogfood-runner";
import { buildVizFrame } from "./viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";

describe("clock split row W1", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
  });

  it("W1: wall step-back does not change budget/HUD counts; dt stays >= 0", () => {
    const sim = { mono: 0, wall: 1_000_000 };
    const stepMs = 1000 / 60;
    setVizClockInjector(() => sim.mono);
    setVizWallClockInjector(() => sim.wall);
    syncVizTileScope(["dogfood"]);

    setVizWallClockInjector(() => 1_000_000 + sim.mono);
    const baseline = runDogfoodSoak({
      state: fatLanFixture(),
      framesPerPack: 120,
      simTimeMs: { value: 0 },
      clockStepMs: stepMs,
      buildCostMs: (i) => (i % 3 === 2 ? 20 : 4),
      now: () => sim.mono,
      presentStepMs: stepMs,
    });

    sim.mono = 0;
    sim.wall = 1_000_000;
    let prevClock = 0;
    const dts: number[] = [];
    for (let i = 0; i < 120; i++) {
      if (i === 60) sim.wall -= 5000;
      sim.mono += stepMs;
      sim.wall += stepMs;
      const frame = buildVizFrame(fatLanFixture(), monoMs(prevClock), 0.1);
      dts.push(frame.dt);
      prevClock = sim.mono;
    }
    expect(dts.every((d) => d >= 0)).toBe(true);
    const stepSec = stepMs / 1000;
    expect(dts.slice(1).every((d) => Math.abs(d - stepSec) < 1e-6)).toBe(true);

    sim.mono = 0;
    sim.wall = 1_000_000;
    setVizWallClockInjector(() => {
      const f = Math.floor(sim.mono / stepMs);
      return 1_000_000 + sim.mono - (f >= 60 ? 5000 : 0);
    });
    const stepped = runDogfoodSoak({
      state: fatLanFixture(),
      framesPerPack: 120,
      simTimeMs: { value: 0 },
      clockStepMs: stepMs,
      buildCostMs: (i) => (i % 3 === 2 ? 20 : 4),
      now: () => sim.mono,
      presentStepMs: stepMs,
    });

    const basePack = baseline.packs.find((p) => p.packId === "packet-tunnel")!;
    const stepPack = stepped.packs.find((p) => p.packId === "packet-tunnel")!;
    expect(stepPack.delivered).toBe(basePack.delivered);
    expect(stepPack.skipped).toBe(basePack.skipped);
    expect(stepPack.delivered).toBe(DOGFOOD_SOAK_PATTERN_EXPECTED.delivered);
    expect(stepPack.skipped).toBe(DOGFOOD_SOAK_PATTERN_EXPECTED.skipped);
  });
});
