import { applyDevVizWallFlagsOnBuild, resetDevVizWallFlagsStateForTests } from "./viz-dev-wall-flags";
import { resetVizClockInjectors, setVizClockInjector, vizBuildCostTicks } from "./viz-clock";
import { VizFrameBudget, type VizDataFrame } from "../plugins/viz-host";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import { VizHud } from "../ui/viz-hud";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
} from "../app/main-viz-tile-lines";

export interface WallHarnessResult {
  skipped: number;
  limitedWallLines: number;
  perTileLimitedLines: number;
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
  for (let i = 0; i < frames; i++) {
    budget.setTileId(primary);
    budget.deliver(state, prevClock, 0, () => {}, () => emptyBuild());
    vizBuildCostTicks(i);
    mono += 1000 / 60;
    vizTileBudgetRegistry.advanceTick();
    const budgetTile = vizTileBudgetRegistry.getTile(primary);
    if (tiles.length > 1) {
      for (const id of tiles) {
        const t = vizTileBudgetRegistry.getTile(id);
        t.shedding = budgetTile.shedding;
        if (budgetTile.lastDeliveredFrame) t.lastDeliveredFrame = budgetTile.lastDeliveredFrame;
      }
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
  const limitedWall = skipEl?.textContent?.includes("LIMITED") ? 1 : 0;
  let perTileLimited = 0;
  for (const el of parent.querySelectorAll(".viz-hud-tile-share")) {
    if (el.textContent?.includes("LIMITED")) perTileLimited++;
  }
  return {
    skipped: vizTileBudgetRegistry.getTile(primary).skipped,
    limitedWallLines: limitedWall,
    perTileLimitedLines: perTileLimited,
  };
}

export function runWallHarnessNegative(
  tiles: readonly string[],
  flag: string,
): WallHarnessResult {
  return runWallHarness(tiles, flag, 120);
}
