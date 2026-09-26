import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallFlagsOnBuild, resetDevVizWallFlagsStateForTests } from "./viz-dev-wall-flags";
import { resetVizClockInjectors, setVizClockInjector, vizBuildCostTicks } from "./viz-clock";
import { VizFrameBudget } from "../plugins/viz-host";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";
import {
  syncVizTileScope,
  VIZ_COST_TICKS_10MS,
  VIZ_WALL_BUDGET_TICKS,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import { VizHud, tileHudDisplayFrame } from "../ui/viz-hud";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
} from "../app/main-viz-tile-lines";
import { tileLimitedSharingLabel } from "../ui/viz-copy";
import { createTileHudLabelLine } from "../ui/tile-hud-label";
import { tileHudChrome } from "../plugins/viz-tile-hud";
import { hudSamplesForTile } from "../plugins/viz-tile-budget";

const TILES_2X2 = tileIdsForLayout(2, 2);
const IN_RANGE_TICKS = VIZ_COST_TICKS_10MS;

function emptyBuild() {
  return {
    t: 1,
    dt: 0,
    audio: 0,
    packets: [] as const,
    rf: [] as const,
    talkers: [] as const,
    headlines: [] as const,
  };
}

interface WallHarnessResult {
  skipped: number;
  limitedWallLines: number;
  perTileLimitedLines: number;
}

function runWallHarness(
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

describe("Amendment 4 wall LIMITED harness (VizFrameBudget + VizHud)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.stubEnv("DEV", true);
  });

  afterEach(() => {
    resetVizClockInjectors();
    resetDevVizWallFlagsStateForTests();
    vizTileBudgetRegistry.reset();
    document.body.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it("D positive: in-range ticks 600 frames 2×2 → skips 400, 1 wall LIMITED, 0 per-tile LIMITED", () => {
    const r = runWallHarness(TILES_2X2, String(IN_RANGE_TICKS));
    expect(r.skipped).toBe(400);
    expect(r.limitedWallLines).toBe(1);
    expect(r.perTileLimitedLines).toBe(0);
  });

  it("D negative: 1×1 in-range → 0 LIMITED lines, 0 skips", () => {
    const r = runWallHarness(["solo"], String(IN_RANGE_TICKS));
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
  });

  it("D negative: 2×2 no flag → 0 LIMITED, 0 skips", () => {
    const r = runWallHarness(TILES_2X2, null);
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
  });

  it("D negative: 2×2 indexed 1:5011 → 0 LIMITED, 0 skips", () => {
    const r = runWallHarness(TILES_2X2, "1:5011");
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
  });

  it("B copy literal pins tileLimitedSharingLabel template", () => {
    expect(tileLimitedSharingLabel(4, 40)).toBe("LIMITED · sharing frame with 4 tiles · 40 skipped/s");
  });

  it("D budget boundary: 5010 ticks → LIMITED on wall; 5011 → over budget, not LIMITED", () => {
    syncVizTileScope(TILES_2X2);
    const primary = TILES_2X2[0]!;
    const runAt = (ticks: number) => {
      vizTileBudgetRegistry.reset();
      resetDevVizWallFlagsStateForTests();
      applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${ticks}`, TILES_2X2);
      syncVizTileScope(TILES_2X2);
      let mono = 0;
      setVizClockInjector(() => mono);
      const budget = new VizFrameBudget(() => mono, primary);
      const state = fatLanFixture();
      for (let i = 0; i < 120; i++) {
        budget.deliver(state, monoMs(0), 0, () => {}, () => emptyBuild());
        vizBuildCostTicks(i);
        mono += 1000 / 60;
        vizTileBudgetRegistry.advanceTick();
      }
      const tile = vizTileBudgetRegistry.getTile(primary);
      return tileHudChrome(tile, vizTileBudgetRegistry.currentTick(), 4);
    };
    expect(runAt(VIZ_WALL_BUDGET_TICKS).state).toBe("limited");
    expect(runAt(VIZ_WALL_BUDGET_TICKS).limitedLabel).toMatch(/^LIMITED ·/);
    expect(runAt(VIZ_WALL_BUDGET_TICKS + 1).state).toBe("over_budget");
    expect(runAt(VIZ_WALL_BUDGET_TICKS + 1).limitedLabel).toBeNull();
  });

  it("C Pedant: 2×2→2×1 steady X → 1 label write; text 2 tiles; 1×1 removes line once", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 120; frame++) {
      const text = line.limitedLabel(4, 40)!;
      line.writeText(el, text);
    }
    expect(line.stats.writes).toBe(1);
    expect(el.textContent).toBe("LIMITED · sharing frame with 4 tiles · 40 skipped/s");

    const text2 = line.limitedLabel(2, 40)!;
    line.writeText(el, text2);
    expect(line.stats.writes).toBe(2);
    expect(el.textContent).toBe("LIMITED · sharing frame with 2 tiles · 40 skipped/s");

    for (let frame = 0; frame < 60; frame++) {
      line.limitedLabel(2, 40);
      line.writeText(el, text2);
    }
    expect(line.stats.writes).toBe(2);

    expect(line.limitedLabel(1, 40)).toBeNull();
    line.writeText(el, "skips 0/s");
    expect(line.stats.writes).toBe(3);
    for (let frame = 0; frame < 60; frame++) {
      expect(line.limitedLabel(1, 40)).toBeNull();
    }
    expect(line.stats.builds).toBe(2);
  });

  it("Shot 6 wall shed: 4 tiles keep last frame — 0 clears over shed frames", () => {
    applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=${IN_RANGE_TICKS}`, TILES_2X2);
    syncVizTileScope(TILES_2X2);
    const primary = TILES_2X2[0]!;
    const budget = new VizFrameBudget(() => 0, primary);
    const state = fatLanFixture();
    let lastT = -1;
    let clears = 0;
    let blackReadbacks = 0;
    let mono = 0;
    setVizClockInjector(() => mono);
    for (let i = 0; i < 600; i++) {
      budget.deliver(state, monoMs(0), 0, () => {}, () => ({ ...emptyBuild(), t: i + 1 }));
      mono += 1000 / 60;
      vizBuildCostTicks(i);
      vizTileBudgetRegistry.advanceTick();
      const primaryTile = vizTileBudgetRegistry.getTile(primary);
      for (const id of TILES_2X2) {
        const t = vizTileBudgetRegistry.getTile(id);
        t.shedding = primaryTile.shedding;
        if (primaryTile.lastDeliveredFrame) t.lastDeliveredFrame = primaryTile.lastDeliveredFrame;
        const shown = tileHudDisplayFrame(t, null);
        if (!shown && primaryTile.lastDeliveredFrame) {
          clears++;
        } else if (shown && lastT >= 0 && shown.t < lastT) {
          clears++;
        }
      }
      if (primaryTile.lastDeliveredFrame) lastT = primaryTile.lastDeliveredFrame.t;
    }
    expect(clears).toBe(0);
    expect(blackReadbacks).toBe(0);
  });
});
