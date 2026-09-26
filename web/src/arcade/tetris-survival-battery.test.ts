import { describe, expect, it } from "vitest";
import {
  emptyBoard,
  seededPieceKindIds,
  simulateAutoplayTrace,
  SURVIVAL_BATTERY_MAX_PIECES,
  SURVIVAL_BATTERY_SEEDS,
} from "./tetris-engine";
import { survivalSeedFixture, TETRIS_SURVIVAL_FIXTURE } from "./fixtures/tetris-survival-baseline";

describe("Tetris survival battery", { timeout: 60_000 }, () => {
  it("fixture header matches main 6520b01 and generator script", () => {
    expect(TETRIS_SURVIVAL_FIXTURE.mainBaseSha).toBe("6520b014472c05f831ac5204429be2affb8473cb");
    expect(TETRIS_SURVIVAL_FIXTURE.generatorScriptSha).toMatch(/^[a-f0-9]{64}$/);
    expect(TETRIS_SURVIVAL_FIXTURE.seeds).toHaveLength(20);
  });

  it.each(SURVIVAL_BATTERY_SEEDS.map((seed) => [seed] as const))(
    "seed %i survives at least the committed baseline with fixed placement cost",
    (seed) => {
      const fx = survivalSeedFixture(seed);
      const kinds = seededPieceKindIds(SURVIVAL_BATTERY_MAX_PIECES, seed);
      const trace = simulateAutoplayTrace(emptyBoard(), kinds);
      expect(trace.pieces).toBeGreaterThanOrEqual(fx.baselinePieces);
      expect(trace.placementsEvaluated).toBe(fx.placementsEvaluated);
    },
  );
});
