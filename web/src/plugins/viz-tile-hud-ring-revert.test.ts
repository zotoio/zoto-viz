import { describe, expect, it } from "vitest";
import { VIZ_HUD_SAMPLE_CAP, type VizTileHudSample } from "./viz-tile-budget";

function makeHudRing(): VizTileHudSample[] {
  const ring = new Array<VizTileHudSample>(VIZ_HUD_SAMPLE_CAP);
  for (let i = 0; i < VIZ_HUD_SAMPLE_CAP; i++) ring[i] = { tick: 0, kind: "skip" };
  return ring;
}

describe("HUD ring revert row B", () => {
  it("B revert: push on a preallocated ring grows past the cap", () => {
    const ring = makeHudRing();
    for (let i = 0; i < 3600; i++) {
      ring.push({ tick: i, kind: "build", costTicks: 1200 });
    }
    expect(ring.length).toBe(VIZ_HUD_SAMPLE_CAP + 3600);
    expect(ring.length === VIZ_HUD_SAMPLE_CAP).toBe(false);
  });
});
