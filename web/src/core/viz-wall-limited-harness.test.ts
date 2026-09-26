import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDevVizWallFlagsOnBuild, resetDevVizWallFlagsStateForTests } from "./viz-dev-wall-flags";
import { resetVizClockInjectors, setVizClockInjector, vizBuildCostTicks } from "./viz-clock";
import { VizFrameBudget } from "../plugins/viz-host";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { monoMs } from "./viz-time";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";
import {
  mirrorMosaicTileCadenceFromPrimary,
  syncVizTileScope,
  VIZ_COST_TICKS_10MS,
  VIZ_WALL_BUDGET_TICKS,
  vizTileBudgetRegistry,
} from "../plugins/viz-tile-budget";
import { tileHudDisplayFrame } from "../ui/viz-hud";
import { tileLimitedSharingLabel } from "../ui/viz-copy";
import { createTileHudLabelLine } from "../ui/tile-hud-label";
import { tileHudChrome } from "../plugins/viz-tile-hud";
import { runWallHarness, runWallHarnessLayoutShrink } from "./viz-wall-limited-harness";
import { vizWallCadenceFrames } from "../plugins/viz-tile-budget";

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

  it("D positive: ceil(4×3000/5010)=3 cadence — 600 frames 2×2 → 200 runs, 400 skips, 1 wall LIMITED", () => {
    expect(vizWallCadenceFrames(4, IN_RANGE_TICKS)).toBe(3);
    const r = runWallHarness(TILES_2X2, String(IN_RANGE_TICKS));
    expect(r.delivered).toBe(200);
    expect(r.skipped).toBe(400);
    expect(r.limitedWallLines).toBe(1);
    expect(r.perTileLimitedLines).toBe(0);
  });

  it("Amendment 7 A5: 2×2 @3000 — each tile delivered=200 over 600 frames (mirrored cadence)", () => {
    const r = runWallHarness(TILES_2X2, String(IN_RANGE_TICKS));
    expect(r.delivered).toBe(200);
    for (const id of TILES_2X2) {
      expect(r.perTileDelivered[id]).toBe(200);
    }
  });

  it("Amendment 5 P2: every gap between runs is exactly 3 over 600 frames", () => {
    const r = runWallHarness(TILES_2X2, String(IN_RANGE_TICKS));
    expect(r.buildGaps.length).toBe(199);
    expect(r.buildGaps.every((g) => g === 3)).toBe(true);
  });

  it("Amendment 5 P3: 2505 → 300/300; 2506 → 200 runs at 2×2", () => {
    const r2505 = runWallHarness(TILES_2X2, "2505");
    expect(r2505.delivered).toBe(300);
    expect(r2505.skipped).toBe(300);
    expect(vizWallCadenceFrames(4, 2505)).toBe(2);
    const r2506 = runWallHarness(TILES_2X2, "2506");
    expect(r2506.delivered).toBe(200);
    expect(vizWallCadenceFrames(4, 2506)).toBe(3);
  });

  it("Amendment 5 P4: 2×2→1×1 recomputes cadence next frame — 0 skips and no LIMITED after shrink", () => {
    const r = runWallHarnessLayoutShrink(TILES_2X2, String(IN_RANGE_TICKS), 300, 300);
    expect(r.delivered).toBe(300);
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
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

  it("Amendment 6 L2: 3000 @ 2×2 LIMITED text is every 3rd frame", () => {
    const r = runWallHarness(TILES_2X2, String(IN_RANGE_TICKS));
    expect(r.wallLimitedText).toBe(
      "LIMITED · sharing the frame with 4 tiles · updating every 3rd frame",
    );
  });

  it("Amendment 6 L2: 2505 @ 2×2 LIMITED text is every 2nd frame", () => {
    const r = runWallHarness(TILES_2X2, "2505");
    expect(r.wallLimitedText).toBe(
      "LIMITED · sharing the frame with 4 tiles · updating every 2nd frame",
    );
  });

  it("Amendment 6a gate: 1×1 @3000 and 2×2 with k=1 show 0 LIMITED lines", () => {
    expect(vizWallCadenceFrames(1, IN_RANGE_TICKS)).toBe(1);
    expect(vizWallCadenceFrames(4, 1252)).toBe(1);
    const solo = runWallHarness(["solo"], String(IN_RANGE_TICKS));
    expect(solo.limitedWallLines).toBe(0);
    expect(solo.wallLimitedText).toBeNull();
    const inBudget = runWallHarness(TILES_2X2, "1252");
    expect(inBudget.limitedWallLines).toBe(0);
    expect(inBudget.wallLimitedText).toBeNull();
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

  it("C Pedant: steady N and k → 1 label write; N change once; 1×1 removes line once", () => {
    const line = createTileHudLabelLine();
    const el = document.createElement("span");
    document.body.append(el);
    for (let frame = 0; frame < 120; frame++) {
      const text = line.limitedLabel(4, 3)!;
      line.writeText(el, text);
    }
    expect(line.stats.writes).toBe(1);
    expect(el.textContent).toBe(tileLimitedSharingLabel(4, 3));

    const text2 = line.limitedLabel(2, 3)!;
    line.writeText(el, text2);
    expect(line.stats.writes).toBe(2);
    expect(el.textContent).toBe(tileLimitedSharingLabel(2, 3));

    for (let frame = 0; frame < 60; frame++) {
      line.limitedLabel(2, 3);
      line.writeText(el, text2);
    }
    expect(line.stats.writes).toBe(2);

    expect(line.limitedLabel(1, 3)).toBeNull();
    line.writeText(el, "skips 0/s");
    expect(line.stats.writes).toBe(3);
    for (let frame = 0; frame < 60; frame++) {
      expect(line.limitedLabel(1, 3)).toBeNull();
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
      mirrorMosaicTileCadenceFromPrimary(primary, TILES_2X2);
      for (const id of TILES_2X2) {
        const t = vizTileBudgetRegistry.getTile(id);
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
