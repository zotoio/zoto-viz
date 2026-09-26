import { applyDevVizWallFlagsOnBuild, resetDevVizWallFlagsStateForTests } from "./viz-dev-wall-flags";
import { resetVizClockInjectors, setVizClockInjector, vizBuildCostTicks } from "./viz-clock";
import { VizFrameBudget, type VizDataFrame } from "../plugins/viz-host";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import {
  mirrorMosaicTileCadenceFromPrimary,
  syncVizTileScope,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import { VizHud } from "../ui/viz-hud";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
} from "../app/main-viz-tile-lines";

export interface WallHarnessResult {
  skipped: number;
  delivered: number;
  /** Delivered build count per mosaic tile id (primary cadence mirrored to siblings). */
  perTileDelivered: Record<string, number>;
  limitedWallLines: number;
  perTileLimitedLines: number;
  /** Final `.viz-hud-skip` text when LIMITED was shown. */
  wallLimitedText: string | null;
  /** Gaps between consecutive builds (attempt indices). */
  buildGaps: number[];
}

function emptyBuild(): VizDataFrame {
  return {
    t: 1,
    dt: 0,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  };
}

export function runWallHarness(
  tiles: readonly string[],
  flag: string | null,
  frames = 600,
): WallHarnessResult {
  resetDevVizWallFlagsStateForTests();
  resetVizClockInjectors();
  vizTileBudgetRegistry.reset();
  applyDevVizWallFlagsOnBuild(flag !== null ? `?vizTileCostTicks=${flag}` : "", tiles);
  syncVizTileScope(tiles);
  const primary = tiles[0]!;
  const budget = new VizFrameBudget(() => 0, primary);
  const state = fatLanFixture();
  const parent = document.createElement("div");
  document.body.append(parent);
  const hud = new VizHud(parent, () => {});
  hud.setActive("packet-tunnel", "tunnel");
  hud.syncMosaicTileHudLines(tiles.length > 1 ? tiles : []);
  const lines = mosaicTileBudgetLines(tiles.length > 1 ? tiles : ["main"]);
  if (lines) bindMosaicTileBudgetLines(lines, (id) => vizTileBudgetRegistry.getTile(id));

  let mono = 0;
  setVizClockInjector(() => mono);
  let prevClock = monoMs(0);
  const buildAt: number[] = [];
  for (let i = 0; i < frames; i++) {
    budget.setTileId(primary);
    const built = budget.deliver(state, prevClock, 0, () => {}, () => emptyBuild());
    if (built) buildAt.push(i);
    vizBuildCostTicks(i);
    mono += 1000 / 60;
    vizTileBudgetRegistry.advanceTick();
    const budgetTile = vizTileBudgetRegistry.getTile(primary);
    if (tiles.length > 1) {
      mirrorMosaicTileCadenceFromPrimary(primary, tiles);
    }
    const nowTick = vizTileBudgetRegistry.currentTick();
    hud.tick({
      packId: "packet-tunnel",
      packName: "tunnel",
      stats: budget.stats,
      frame: budget.lastBuilt,
      state,
      now: nowTick / 300,
      tileBudget: budgetTile,
      activeTiles: tiles.length,
      tileBudgetLines: lines,
    });
    if (budget.lastBuilt) prevClock = monoMs((i + 1) * (1000 / 60));
  }

  const skipEl = parent.querySelector(".viz-hud-skip");
  const skipText = skipEl?.textContent ?? null;
  const limitedWall = skipText?.includes("LIMITED") ? 1 : 0;
  let perTileLimited = 0;
  for (const el of parent.querySelectorAll(".viz-hud-tile-share")) {
    if (el.textContent?.includes("LIMITED")) perTileLimited++;
  }
  const buildGaps: number[] = [];
  for (let g = 1; g < buildAt.length; g++) {
    buildGaps.push(buildAt[g]! - buildAt[g - 1]!);
  }
  const primaryTile = vizTileBudgetRegistry.getTile(primary);
  const perTileDelivered: Record<string, number> = {};
  for (const id of tiles) {
    perTileDelivered[id] = vizTileBudgetRegistry.getTile(id).delivered;
  }
  return {
    skipped: primaryTile.skipped,
    delivered: primaryTile.delivered,
    perTileDelivered,
    limitedWallLines: limitedWall,
    perTileLimitedLines: perTileLimited,
    wallLimitedText: limitedWall ? skipText : null,
    buildGaps,
  };
}

/** P4: run on 2×2 then re-scope to 1×1 mid-harness; counts are post layout change only. */
export function runWallHarnessLayoutShrink(
  tiles2x2: readonly string[],
  flag: string,
  framesBefore = 300,
  framesAfter = 300,
): WallHarnessResult {
  resetDevVizWallFlagsStateForTests();
  resetVizClockInjectors();
  vizTileBudgetRegistry.reset();
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${flag}`, tiles2x2);
  syncVizTileScope(tiles2x2);
  const primary = tiles2x2[0]!;
  const budget = new VizFrameBudget(() => 0, primary);
  const state = fatLanFixture();
  const parent = document.createElement("div");
  document.body.append(parent);
  const hud = new VizHud(parent, () => {});
  hud.setActive("packet-tunnel", "tunnel");
  hud.syncMosaicTileHudLines(tiles2x2);
  const lines = mosaicTileBudgetLines(tiles2x2);
  if (lines) bindMosaicTileBudgetLines(lines, (id) => vizTileBudgetRegistry.getTile(id));

  let mono = 0;
  setVizClockInjector(() => mono);
  let prevClock = monoMs(0);
  const buildAt: number[] = [];
  const totalFrames = framesBefore + framesAfter;
  for (let i = 0; i < totalFrames; i++) {
    if (i === framesBefore) {
      syncVizTileScope(["solo"]);
      budget.setTileId("solo");
      hud.syncMosaicTileHudLines([]);
    }
    const tileId = i < framesBefore ? primary : "solo";
    budget.setTileId(tileId);
    const built = budget.deliver(state, prevClock, 0, () => {}, () => emptyBuild());
    if (i >= framesBefore && built) buildAt.push(i - framesBefore);
    vizBuildCostTicks(i);
    mono += 1000 / 60;
    vizTileBudgetRegistry.advanceTick();
    const budgetTile = vizTileBudgetRegistry.getTile(tileId);
    const nowTick = vizTileBudgetRegistry.currentTick();
    hud.tick({
      packId: "packet-tunnel",
      packName: "tunnel",
      stats: budget.stats,
      frame: budget.lastBuilt,
      state,
      now: nowTick / 300,
      tileBudget: budgetTile,
      activeTiles: i < framesBefore ? tiles2x2.length : 1,
      tileBudgetLines: i < framesBefore ? lines : undefined,
    });
    if (budget.lastBuilt) prevClock = monoMs((i + 1) * (1000 / 60));
  }

  const skipEl = parent.querySelector(".viz-hud-skip");
  const skipText = skipEl?.textContent ?? null;
  const limitedWall = skipText?.includes("LIMITED") ? 1 : 0;
  const soloTile = vizTileBudgetRegistry.getTile("solo");
  const buildGaps: number[] = [];
  for (let g = 1; g < buildAt.length; g++) {
    buildGaps.push(buildAt[g]! - buildAt[g - 1]!);
  }
  return {
    skipped: soloTile.skipped,
    delivered: soloTile.delivered,
    perTileDelivered: { solo: soloTile.delivered },
    limitedWallLines: limitedWall,
    perTileLimitedLines: 0,
    wallLimitedText: limitedWall ? skipText : null,
    buildGaps,
  };
}

export function runWallHarnessNegative(
  tiles: readonly string[],
  flag: string,
): WallHarnessResult {
  return runWallHarness(tiles, flag, 120);
}
