import { describe, expect, it } from "vitest";
import { seededPieceKindIds } from "./tetris-engine";
import { survivalSeedFixture, TETRIS_SURVIVAL_FIXTURE } from "./fixtures/tetris-survival-baseline";

describe("Tetris survival piece generator", () => {
  it.each(TETRIS_SURVIVAL_FIXTURE.seeds.map((s) => [s.seed] as const))(
    "seed %i first 50 kind ids match fixture",
    (seed) => {
      const fx = survivalSeedFixture(seed);
      expect(seededPieceKindIds(50, seed)).toEqual(fx.first50KindIds);
    },
  );

});
