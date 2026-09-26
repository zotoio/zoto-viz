import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDevVizWallFlagsOnBuild,
  devWallFlagParseCounts,
  resetDevWallFlagParseCountsForTest,
} from "./viz-dev-wall-flags";
import { resetVizClockInjectors, vizBuildCostTicksForTile, vizWallMs } from "./viz-clock";
import { createTileHudLabelLine } from "../ui/tile-hud-label";
import { VizFrameBudget } from "../plugins/viz-host";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";
import { resetNixieFormatterCache } from "../plugins/nixie-wall-clock";
import {
  resetNixiePackHostScope,
  runPackFrameHandler,
  VIZ_PACK_TILE_ID_OPT,
} from "../plugins/viz-pack-host";
import type { VizDataFrame } from "../plugins/viz-host";

const TILES_2X2 = tileIdsForLayout(2, 2);

function emptyFrame(): VizDataFrame {
  return { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
}

function wallMsAtFrame(t0Ms: number, frame: number): number {
  return t0Ms + Math.floor((frame * 1000) / 60);
}

describe("dev viz wall flags", () => {
  afterEach(() => {
    resetVizClockInjectors();
    resetDevWallFlagParseCountsForTest();
    vizTileBudgetRegistry.reset();
    resetNixieFormatterCache();
    resetNixiePackHostScope();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("F5 (i): 600 frames — 1 parse per flag; rebuild adds 1 each", () => {
    vi.stubEnv("DEV", true);
    resetDevWallFlagParseCountsForTest();
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:1&vizWallClock=13:05", TILES_2X2);
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
    expect(devWallFlagParseCounts()).toEqual({ vizTileCostTicks: 1, vizWallClock: 1 });
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:1&vizWallClock=13:05", tileIdsForLayout(2, 2));
    expect(devWallFlagParseCounts()).toEqual({ vizTileCostTicks: 2, vizWallClock: 2 });
  });

  it("F5 (ii): ?vizWallClock=13:05 seconds on — 10 uploads per tile (2×2)", () => {
    vi.stubEnv("DEV", true);
    const t0 = Date.UTC(2024, 5, 15, 13, 5, 0, 0);
    vi.spyOn(Date, "now").mockImplementation(() => t0);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", TILES_2X2);
    const look = { format: "24", seconds: "1" };
    const writeBuffer = vi.fn();
    for (let frame = 0; frame < 600; frame++) {
      vi.spyOn(Date, "now").mockImplementation(() => wallMsAtFrame(t0, frame));
      for (const tileId of TILES_2X2) {
        runPackFrameHandler("nixie-clock", emptyFrame(), {
          writeBuffer: () => writeBuffer(),
          writeUniform: () => {},
          writeParticles: () => {},
        }, { ...look, [VIZ_PACK_TILE_ID_OPT]: tileId });
      }
    }
    expect(writeBuffer).toHaveBeenCalledTimes(40);
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

  it("F5 (iv): ?vizTileCostTicks=1:5011 — only tile 1 LIMITED at 2×2", () => {
    vi.stubEnv("DEV", true);
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:5011", TILES_2X2);
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

  it("F5 (v): two-nixie wall ?vizWallClock=13:05 — same time on both tiles", () => {
    vi.stubEnv("DEV", true);
    const t0 = Date.UTC(2024, 5, 15, 13, 5, 0, 0);
    vi.spyOn(Date, "now").mockImplementation(() => t0);
    applyDevVizWallFlagsOnBuild("?vizWallClock=13:05", ["a", "b"]);
    const a = vizWallMs();
    const b = vizWallMs();
    expect(a).toBe(b);
    expect(a).toBe(t0);
  });

  it("F5 (vi) prod: query inert when not DEV", () => {
    vi.stubEnv("DEV", false);
    const real = 1_700_000_002_000;
    vi.spyOn(Date, "now").mockImplementation(() => real);
    applyDevVizWallFlagsOnBuild("?vizWallClock=01:05", TILES_2X2);
    expect(vizWallMs()).toBe(real);
  });

  it("F5 (vi) prod bundle: dist has no vizWallClock string", () => {
    const assets = join(import.meta.dirname, "../../dist/assets");
    let js = "";
    try {
      for (const name of readdirSync(assets)) {
        if (name.endsWith(".js")) js += readFileSync(join(assets, name), "utf8");
      }
    } catch {
      return;
    }
    expect(js.includes("vizWallClock")).toBe(false);
  });
});

function expectNoLimitedAfterSoak(tiles: readonly string[]): void {
  syncVizTileScope(tiles);
  const budget = new VizFrameBudget(() => 0, tiles[0]);
  const state = fatLanFixture();
  const line = createTileHudLabelLine();
  const el = document.createElement("span");
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const text = line.limitedLabel(1, 0);
    if (text) line.writeText(el, text);
  }
  expect(el.textContent).toBe("");
  expect(el.textContent).not.toContain("LIMITED");
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
}
