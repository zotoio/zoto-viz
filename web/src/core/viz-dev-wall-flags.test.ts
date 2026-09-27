import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vizClock from "./viz-clock";
import {
  applyDevVizWallFlagsOnBuild,
  resetDevVizWallFlagsStateForTests,
} from "./viz-dev-wall-flags";
import { resetVizClockInjectors, vizBuildCostTicks, vizWallMs } from "./viz-clock";
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
import { devVizWallFlagBadInputMessage } from "../ui/viz-copy";
import {
  devVizWallTileCostBadInputMessage,
} from "./viz-dev-wall-flags";

const TILES_2X2 = tileIdsForLayout(2, 2);
/** In-range dogfood cost (not 5010/5011 wall boundary). */
const LIMITED_DOGFOOD_TICKS = VIZ_COST_TICKS_10MS;

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
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
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1&vizWallClock=13:05", TILES_2X2);
    expect(vizBuildCostTicks(0)).toBe(1);
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
      vizBuildCostTicks(i);
      vizWallMs();
    }
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", tileIdsForLayout(2, 2));
    expect(vizBuildCostTicks(0)).toBeUndefined();
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

  it("F5 (iii) bad tile cost: 1:5011 — bad-input message, no injector on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:5011", TILES_2X2);
    expectBadWallCostAbsent("1:5011");
  });

  it("F5 (iii) bad tile cost: 1:abc — bad-input message, no injector on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:abc", TILES_2X2);
    expectBadWallCostAbsent("1:abc");
  });

  it("F5 (iii) bad tile cost: 1:-5 — bad-input message, no injector on 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:-5", TILES_2X2);
    expectBadWallCostAbsent("1:-5");
  });

  it("F5 (iii) whole-wall 5011 — injector set (over-budget path, not bad input)", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=5011", TILES_2X2);
    expect(vizBuildCostTicks(0)).toBe(5011);
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

  it.skipIf(
    !existsSync(distAssetsDir) && process.env.VIZ_REQUIRE_DIST !== "1",
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

  it("Q3 bad whole-wall cost 1: — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("1:");
  });

  it("Q3 bad whole-wall cost 1.0 — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("1.0");
  });

  it("Q3 bad whole-wall cost 0x1 — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("0x1");
  });

  it("Q3 bad whole-wall cost 1e3 — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("1e3");
  });

  it("Q3 bad whole-wall cost 2.5 — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("2.5");
  });

  it("Q3 bad whole-wall cost empty — absent", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("");
  });

  it("Q3 bad whole-wall cost 1:1e3 — absent (indexed form rejected)", () => {
    vi.stubEnv("DEV", true);
    expectBadWallCostToken("1:1e3");
  });
});

function expectBadWallCostAbsent(raw: string): void {
  expect(vizBuildCostTicks(0)).toBeUndefined();
  expect(devVizWallTileCostBadInputMessage()).toBe(
    devVizWallFlagBadInputMessage("vizTileCostTicks", raw),
  );
}

function expectBadWallCostToken(flag: string): void {
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${flag}`, TILES_2X2);
  expectBadWallCostAbsent(flag.trim() || flag);
  resetDevVizWallFlagsStateForTests();
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${LIMITED_DOGFOOD_TICKS}`, TILES_2X2);
  expect(vizBuildCostTicks(0)).toBe(LIMITED_DOGFOOD_TICKS);
  syncVizTileScope(TILES_2X2);
  const budget = new VizFrameBudget(() => 0, TILES_2X2[0]!);
  const state = fatLanFixture();
  for (let i = 0; i < 120; i++) {
    budget.deliver(state, monoMs(0), 0, () => {}, () => emptyFrame());
    vizBuildCostTicks(i);
    vizTileBudgetRegistry.advanceTick();
  }
  const chrome = tileHudChrome(
    vizTileBudgetRegistry.getTile(TILES_2X2[0]!),
    119 * 300,
    TILES_2X2.length,
  );
  expect(chrome.state).toBe("limited");
}
