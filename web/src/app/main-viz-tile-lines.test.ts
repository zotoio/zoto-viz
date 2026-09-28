import { describe, expect, it } from "vitest";
import {
  bindMosaicTileBudgetLines,
  mosaicTileBudgetLines,
  resetVizHudTileBudgetLineAllocCounter,
} from "./main-viz-tile-lines";
import { vizTileBudgetRegistry } from "../plugins/viz-tile-budget";

describe("mosaicTileBudgetLines", () => {
  it("reuses scratch rows with null tile until bindMosaicTileBudgetLines runs", () => {
    resetVizHudTileBudgetLineAllocCounter();
    vizTileBudgetRegistry.reset();
    const lines = mosaicTileBudgetLines(["a", "b"]);
    expect(lines).toHaveLength(2);
    expect(lines!.every((row) => row.tile === null)).toBe(true);
    bindMosaicTileBudgetLines(lines!, (id) => vizTileBudgetRegistry.getTile(id));
    expect(lines![0]!.tile).not.toBeNull();
    expect(lines![1]!.tile).not.toBeNull();
  });
});
