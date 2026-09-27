import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDevVizWallFlagsOnBuild,
  devVizWallTileCostBadInputMessage,
  resetDevVizWallFlagsStateForTests,
} from "../core/viz-dev-wall-flags";
import { devVizWallFlagBadInputMessage } from "../ui/viz-copy";
import { VizHud } from "../ui/viz-hud";
import { tileIdsForLayout } from "../plugins/dogfood-tile-hud";
import { runWallHarnessNegative } from "../core/viz-wall-limited-harness";

const TILES_2X2 = tileIdsForLayout(2, 2);
const BAD_1_3000 = devVizWallFlagBadInputMessage("vizTileCostTicks", "1:3000");

function syncDevWallBadInputOnHud(hud: VizHud): void {
  applyDevVizWallFlagsOnBuild(`?vizTileCostTicks=1:3000`, TILES_2X2);
  hud.syncDevWallBadInputMessage(devVizWallTileCostBadInputMessage());
}

describe("main viz dev wall bad-input path", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.stubEnv("DEV", true);
    resetDevVizWallFlagsStateForTests();
  });

  afterEach(() => {
    resetDevVizWallFlagsStateForTests();
    document.body.innerHTML = "";
    vi.unstubAllEnvs();
  });

  it("Q3 indexed 1:3000 — exact bad-input message, 0 LIMITED lines, 0 skips", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    syncDevWallBadInputOnHud(hud);
    const el = parent.querySelector<HTMLElement>(".viz-hud-dev-bad-input");
    expect(el?.hidden).toBe(false);
    expect(el?.textContent).toBe(BAD_1_3000);
    const r = runWallHarnessNegative(TILES_2X2, "1:3000");
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
    expect(r.perTileLimitedLines).toBe(0);
  });

  it("Q3 indexed 1:5011 — exact bad-input message, 0 LIMITED lines, 0 skips", () => {
    const msg = devVizWallFlagBadInputMessage("vizTileCostTicks", "1:5011");
    const parent = document.createElement("div");
    document.body.append(parent);
    const hud = new VizHud(parent, () => {});
    applyDevVizWallFlagsOnBuild("?vizTileCostTicks=1:5011", TILES_2X2);
    hud.syncDevWallBadInputMessage(devVizWallTileCostBadInputMessage());
    expect(parent.querySelector(".viz-hud-dev-bad-input")?.textContent).toBe(msg);
    const r = runWallHarnessNegative(TILES_2X2, "1:5011");
    expect(r.skipped).toBe(0);
    expect(r.limitedWallLines).toBe(0);
  });
});
