import { describe, expect, it } from "vitest";
import { allTKinds, emptyBoard, simulateAutoplay } from "./tetris-engine";

const MIN_T_SURVIVAL = 48;

describe("Tetris T-piece handling", () => {
  it("survives a long all-T sequence with line clears", () => {
    const t = simulateAutoplay(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(t.toppedOut).toBe(false);
    expect(t.pieces).toBe(MIN_T_SURVIVAL);
    expect(t.lines).toBe(14);
  });

});
