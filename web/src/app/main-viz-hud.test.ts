import { afterEach, describe, expect, it } from "vitest";
import { resetVizClockInjectors } from "../core/viz-clock";
import { VizHud } from "../ui/viz-hud";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { VizFrameBudget } from "../plugins/viz-host";
import { tileIdsForLayout, runTileHudSim, freshHudRegistry } from "../plugins/dogfood-tile-hud";
import { VIZ_CLOCK_STEP_TICKS, VIZ_COST_TICKS_10MS, vizTileBudgetRegistry } from "../plugins/viz-tile-budget";

describe("main HUD tile budget wiring", () => {
  afterEach(() => {
    resetVizClockInjectors();
    vizTileBudgetRegistry.reset();
    document.body.innerHTML = "";
  });

  it("M2: tileBudget on vizHud.tick shows LIMITED label under share pressure", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    hud.setActive("packet-tunnel", "tunnel");
    const reg = freshHudRegistry(tileIdsForLayout(2, 2));
    runTileHudSim(reg, "t0", 120, () => VIZ_COST_TICKS_10MS, 4, 119);
    const tile = reg.getTile("t0");
    const budget = new VizFrameBudget(() => 0, "main");
    const nowTick = 119 * VIZ_CLOCK_STEP_TICKS;
    hud.tick({
      packId: "packet-tunnel",
      packName: "tunnel",
      stats: budget.stats,
      frame: { t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [] },
      state: fatLanFixture(),
      now: nowTick / 300,
      tileBudget: tile,
    });
    const skipEl = parent.querySelector(".viz-hud-skip");
    expect(skipEl?.textContent).toMatch(/LIMITED/);
  });
});
