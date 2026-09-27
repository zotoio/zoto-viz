import baseline from "./tetris-survival-baseline.json";

export type TetrisSurvivalSeedFixture = {
  seed: number;
  baselinePieces: number;
  expectedPieces: number;
  first50KindIds: string[];
  placementsEvaluated: number;
};

export type TetrisSurvivalBaselineFile = {
  mainBaseSha: string;
  generatorScriptSha: string;
  maxPieces: number;
  seedCount: number;
  seeds: TetrisSurvivalSeedFixture[];
};

export const TETRIS_SURVIVAL_FIXTURE = baseline as TetrisSurvivalBaselineFile;

export function survivalSeedFixture(seed: number): TetrisSurvivalSeedFixture {
  const row = TETRIS_SURVIVAL_FIXTURE.seeds.find((s) => s.seed === seed);
  if (!row) throw new Error(`missing survival fixture for seed ${seed}`);
  return row;
}
