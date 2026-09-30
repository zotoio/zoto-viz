import { beforeEach, describe, expect, it } from "vitest";
import { VizHud } from "./viz-hud";
import { syncVizTileScope, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";
import type { StateMsg } from "../core/types";
import { hudSamplesForTile } from "../plugins/viz-tile-budget";
import { VIZ_WALL_BUDGET_TICKS } from "../plugins/viz-tile-constants";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { VizFrameBudget } from "../plugins/viz-host";
import { freshHudRegistry, runTileHudSim } from "../plugins/dogfood-tile-hud";
import { VIZ_CLOCK_STEP_TICKS, VIZ_COST_TICKS_10MS } from "../plugins/viz-tile-budget";

function emptyState(): StateMsg {
  return {
    type: "state",
    ts: 0,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: { pps: 0, bps: 0, packets: 0, bytes: 0, devices: 0, online: 0, flows: 0, active_flows: 0 },
    devices: [],
    flows: [],
    sources: {},
    plugin_state: {},
  };
}

function limitedBudgetTile() {
  const tile = vizTileBudgetRegistry.getTile("a");
  tile.cadenceK = 3;
  tile.lastBuildCostTicks = VIZ_WALL_BUDGET_TICKS + 1;
  const samples = hudSamplesForTile(tile);
  samples.push({ tick: 300, kind: "skip" });
  return tile;
}

describe("VizHud null tile budget lines", () => {
  beforeEach(() => {
    vizTileBudgetRegistry.reset();
    document.body.innerHTML = "";
  });

  it("tick ignores null mosaic tile lines without throwing and leaves their text unchanged", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    hud.setActive("packet-tunnel", "tunnel");
    syncVizTileScope(["b"]);
    hud.syncMosaicTileHudLines(["b"]);
    const rowB = parent.querySelector('[data-tile-id="b"]') as HTMLElement;
    expect(rowB).toBeTruthy();
    const before = rowB.textContent;
    const budget = limitedBudgetTile();
    expect(() => {
      hud.tick({
        packId: "packet-tunnel",
        packName: "tunnel",
        stats: { lastMs: 0, overBudget: 0, skipped: 0, total: 1 },
        frame: null,
        state: emptyState(),
        now: 1,
        tileBudget: budget,
        activeTiles: 1,
        tileBudgetLines: [{ tileId: "b", tile: null }],
      });
    }).not.toThrow();
    expect(rowB.textContent).toBe(before);
  });

  it("LIMITED mate count uses only non-null tile budget lines", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    hud.setActive("packet-tunnel", "tunnel");
    const reg = freshHudRegistry(["a", "b", "c"]);
    runTileHudSim(reg, "a", 120, () => VIZ_COST_TICKS_10MS, 3, 119);
    runTileHudSim(reg, "c", 120, () => VIZ_COST_TICKS_10MS, 3, 119);
    const budget = reg.getTile("a");
    const budgetC = reg.getTile("c");
    const wallBudget = new VizFrameBudget(() => 0, "main");
    const nowTick = 119 * VIZ_CLOCK_STEP_TICKS;
    hud.tick({
      packId: "packet-tunnel",
      packName: "tunnel",
      stats: wallBudget.stats,
      frame: { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] },
      state: fatLanFixture(),
      now: nowTick / 300,
      tileBudget: budget,
      activeTiles: 3,
      tileBudgetLines: [
        { tileId: "a", tile: budget },
        { tileId: "b", tile: null },
        { tileId: "c", tile: budgetC },
      ],
    });
    const skip = parent.querySelector(".viz-hud-skip") as HTMLElement;
    expect(skip.textContent).toContain("sharing the frame with 2 tiles");
  });
});
