import { describe, expect, it } from "vitest";
import { VIZ_WALL_BUDGET_TICKS, vizWallCadenceFrames } from "./viz-tile-budget";

describe("vizWallCadenceFrames (TSE round-up cadence)", () => {
  it("k=1 when N×cost is within wall budget", () => {
    expect(vizWallCadenceFrames(1, 3000)).toBe(1);
    expect(vizWallCadenceFrames(4, 1250)).toBe(1);
  });

  it("ceil(N×cost/5010) at dogfood boundaries", () => {
    expect(vizWallCadenceFrames(4, 3000)).toBe(3);
    expect(vizWallCadenceFrames(4, 2505)).toBe(2);
    expect(vizWallCadenceFrames(4, 2506)).toBe(3);
    expect(vizWallCadenceFrames(4, VIZ_WALL_BUDGET_TICKS)).toBe(4);
  });
});
