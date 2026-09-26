import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vizClock from "./viz-clock";
import {
  applyDevVizWallFlagsOnBuild,
  devShowPerTileHudIndex,
  resetDevVizWallFlagsStateForTests,
} from "./viz-dev-wall-flags";
import { resetVizClockInjectors, vizBuildCostTicksForTile, vizWallMs } from "./viz-clock";
import { clearDevWallFlagClock } from "../plugins/nixie-wall-parts";
import { setVizClockInjector } from "./viz-clock";
import { VizFrameBudget } from "../plugins/viz-host";
import { tileHudChrome } from "../plugins/viz-tile-hud";
import {
  syncVizTileScope,
  VIZ_COST_TICKS_10MS,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import { fillDevWallFlagPartsScratch, nixieWallPartsScratch } from "../plugins/nixie-wall-parts";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";
import { resetNixieFormatterCache } from "../plugins/nixie-wall-clock";
import { resetNixiePackHostScope, runPackFrameHandler } from "../plugins/viz-pack-host";
import type { VizDataFrame } from "../plugins/viz-host";

const TILES_2X2 = tileIdsForLayout(2, 2);
/** Over 2×2 share (1252) but within wall budget (5010) → LIMITED, not OVER BUDGET. */
const LIMITED_DOGFOOD_TICKS = VIZ_COST_TICKS_10MS;

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

function wallMsAtFrame(t0Ms: number, frame: number): number {
  return t0Ms + Math.floor((frame * 1000) / 60);
}

const distAssetsDir = join(import.meta.dirname, "../../dist/assets");

describe("dev viz wall flags", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetVizClockInjectors();
    resetDevVizWallFlagsStateForTests();
    clearDevWallFlagClock();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
  });

  afterEach(() => {
    resetVizClockInjectors();
    resetDevVizWallFlagsStateForTests();
    clearDevWallFlagClock();
    vizTileBudgetRegistry.reset();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("F5 (i): 600 frames — 1 parse per flag; rebuild adds 1 each", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:1&vizWallClock=13:05", TILES_2X2);
    expect(devShowPerTileHudIndex()).toBe(true);
    syncVizTileScope(TILES_2X2);
    const budget = new VizFrameBudget(() => 0, TILES_2X2[0]);
    const state = fatLanFixture();
    for (let i = 0; i < 600; i++) {
      budget.deliver(state, monoMs(0), 0, () => {}, () => ({
        t: 0,
        dt: 0,
        audio: 0,
        packets: [],
        rf: [],
        talkers: [],
        headlines: [],
      }));
      vizBuildCostTicksForTile(TILES_2X2[0]!, i);
      vizWallMs();
    }
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", tileIdsForLayout(2, 2));
    expect(devShowPerTileHudIndex()).toBe(false);
  });

  it("F5 (ii): ?vizWallClock=13:05 seconds on — 10 wall uploads over 600 frames (2×2)", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", TILES_2X2);
    const look = { format: "24", seconds: "1" };
    const writeBuffer = vi.fn();
    for (let frame = 0; frame < 600; frame++) {
      mono += 1000 / 60;
      runPackFrameHandler("nixie-clock", emptyFrame(), {
        writeBuffer: () => writeBuffer(),
        writeUniform: () => {},
        writeParticles: () => {},
      }, look);
    }
    expect(writeBuffer).toHaveBeenCalledTimes(10);
  });

  it("F5 (iii) bad tile cost: 9:5011 — no LIMITED on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=9:5011", TILES_2X2);
    expectNoLimitedAfterSoak(TILES_2X2);
  });

  it("F5 (iii) bad tile cost: 1:abc — no LIMITED on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:abc", TILES_2X2);
    expectNoLimitedAfterSoak(TILES_2X2);
  });

  it("F5 (iii) bad tile cost: 1:-5 — no LIMITED on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:-5", TILES_2X2);
    expectNoLimitedAfterSoak(TILES_2X2);
  });

  it("F5 (iii) bad tile cost: 5011 — no LIMITED on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=5011", TILES_2X2);
    expect(vizBuildCostTicksForTile(TILES_2X2[0]!, 0)).toBeUndefined();
    expectNoLimitedAfterSoak(TILES_2X2);
  });

  it("F5 (iii) bad wall clock: 24:00 — real clock", () => {
    vi.stubEnv("DEV", true);
    const real = 1_700_000_000_123;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=24:00", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it("F5 (iii) bad wall clock: 12:60 — real clock", () => {
    vi.stubEnv("DEV", true);
    const real = 1_700_000_000_456;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=12:60", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it("F5 (iii) bad wall clock: 1:5 — real clock", () => {
    vi.stubEnv("DEV", true);
    const real = 1_700_000_000_789;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=1:5", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it("F5 (iii) bad wall clock: empty — real clock", () => {
    vi.stubEnv("DEV", true);
    const real = 1_700_000_001_000;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it("F5 (iv): ?vizTileCostTicks=1:3000 — only tile 1 LIMITED at 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=1:${LIMITED_DOGFOOD_TICKS}`, TILES_2X2);
    syncVizTileScope(TILES_2X2);
    const state = fatLanFixture();
    const budgets = TILES_2X2.map((id) => new VizFrameBudget(() => 0, id));
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
    expect(vizTileBudgetRegistry.getTile(TILES_2X2[0]).skipped).toBeGreaterThan(0);
    expect(vizTileBudgetRegistry.getTile(TILES_2X2[1]).skipped).toBe(0);
    expect(vizTileBudgetRegistry.getTile(TILES_2X2[2]).skipped).toBe(0);
    expect(vizTileBudgetRegistry.getTile(TILES_2X2[3]).skipped).toBe(0);
  });

  it("F5 (v): two-nixie wall ?vizWallClock=13:05 — identical digits from shared buffer", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", ["a", "b"]);
    const look = { format: "24", seconds: "0" };
    const writeBuffer = vi.fn();
    let buf: number[] = [];
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer: (_s, d) => { writeBuffer(); buf = d; },
      writeUniform: () => {},
      writeParticles: () => {},
    }, look);
    runPackFrameHandler("nixie-clock", emptyFrame(), {
      writeBuffer: () => writeBuffer(),
      writeUniform: () => {},
      writeParticles: () => {},
    }, look);
    expect(writeBuffer).toHaveBeenCalledTimes(1);
    expect(buf.slice(0, 4)).toEqual([1, 3, 0, 5]);
  });

  it("F5 (vi) prod: query inert when not DEV", () => {
    vi.stubEnv("DEV", false);
    const real = 1_700_000_002_000;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=01:05", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it.skipIf(!existsSync(distAssetsDir) && !process.env.CI)(
    "F5 (vi) prod bundle: dist has no vizWallClock string",
    () => {
      expect(existsSync(distAssetsDir)).toBe(true);
      let js = "";
      for (const name of readdirSync(distAssetsDir)) {
        if (name.endsWith(".js")) js += readFileSync(join(distAssetsDir, name), "utf8");
      }
      expect(js.includes("vizWallClock")).toBe(false);
    },
  );

  it("Q4 flag clock: 01:05 +30s rebuild +1s → {h:1,m:5,s:31}", () => {
    vi.stubEnv("DEV", true);
    let mono = 0;
    setVizClockInjector(() => mono);
    applyDevVizWallFlagsOnBuild("?vizWallClock=01:05", TILES_2X2);
    mono = 30_000;
    applyDevVizWallFlagsOnBuild("?vizWallClock=01:05", TILES_2X2);
    mono = 31_000;
    fillDevWallFlagPartsScratch(mono);
    expect({ h: nixieWallPartsScratch.h, m: nixieWallPartsScratch.m, s: nixieWallPartsScratch.s }).toEqual({
      h: 1,
      m: 5,
      s: 31,
    });
  });

  it("Q3 bad tile cost 1: — absent, no LIMITED; 1:3000 would LIMITED tile 1", () => {
    vi.stubEnv("DEV", true);
    expectBadTileCostAbsent("1:");
  });

  it("Q3 bad tile cost 1.0: — absent, no LIMITED; 1:3000 would LIMITED tile 1", () => {
    vi.stubEnv("DEV", true);
    expectBadTileCostAbsent("1.0:");
  });

  it("Q3 bad tile cost 0x1: — absent, no LIMITED; 1:3000 would LIMITED tile 1", () => {
    vi.stubEnv("DEV", true);
    expectBadTileCostAbsent("0x1:");
  });

  it("Q3 bad tile cost 1:1e3 — absent, no LIMITED; 1:3000 would LIMITED tile 1", () => {
    vi.stubEnv("DEV", true);
    expectBadTileCostAbsent("1:1e3");
  });

  it("Q3 bad tile cost 1:2.5 — absent, no LIMITED; 1:3000 would LIMITED tile 1", () => {
    vi.stubEnv("DEV", true);
    expectBadTileCostAbsent("1:2.5");
  });
});

function soakTilesHud(tiles: readonly string[]): void {
  syncVizTileScope(tiles);
  const budgets = tiles.map((id) => new VizFrameBudget(() => 0, id));
  const state = fatLanFixture();
  for (let i = 0; i < 120; i++) {
    for (const budget of budgets) {
      budget.deliver(state, monoMs(0), 0, () => {}, () => ({
        t: 0,
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
}

function expectNoLimitedAfterSoak(tiles: readonly string[]): void {
  soakTilesHud(tiles);
  for (const id of tiles) {
    const chrome = tileHudChrome(vizTileBudgetRegistry.getTile(id), vizTileBudgetRegistry.currentTick(), tiles.length);
    expect(chrome.state).not.toBe("limited");
    expect(chrome.limitedLabel).toBeNull();
  }
}

function expectBadTileCostAbsent(flag: string): void {
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${flag}`, TILES_2X2);
  expect(vizBuildCostTicksForTile(TILES_2X2[0]!, 0)).toBeUndefined();
  expectNoLimitedAfterSoak(TILES_2X2);
  resetDevVizWallFlagsStateForTests();
  vizTileBudgetRegistry.reset();
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=1:${LIMITED_DOGFOOD_TICKS}`, TILES_2X2);
  soakTilesHud(TILES_2X2);
  const chrome = tileHudChrome(
    vizTileBudgetRegistry.getTile(TILES_2X2[0]!),
    vizTileBudgetRegistry.currentTick(),
    TILES_2X2.length,
  );
  expect(chrome.state).toBe("limited");
  expect(vizTileBudgetRegistry.getTile(TILES_2X2[1]!).skipped).toBe(0);
}
