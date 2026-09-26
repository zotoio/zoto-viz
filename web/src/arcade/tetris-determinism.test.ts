import { describe, expect, it } from "vitest";
import {
  DETERMINISM_PIECES_PER_SEED,
  emptyBoard,
  placementKey,
  seededPieceKindIds,
  simulateAutoplayTrace,
  SURVIVAL_BATTERY_SEEDS,
} from "./tetris-engine";

describe("Tetris placement determinism", () => {
  it.each(SURVIVAL_BATTERY_SEEDS.map((seed) => [seed] as const))(
    "seed %i replays the same 60-piece placement sequence",
    (seed) => {
      const kinds = seededPieceKindIds(DETERMINISM_PIECES_PER_SEED, seed);
      const a = simulateAutoplayTrace(emptyBoard(), kinds);
      const b = simulateAutoplayTrace(emptyBoard(), kinds);
      expect(a.placements.map(placementKey)).toEqual(b.placements.map(placementKey));
    },
  );
});
