import {
  alternatingSzKinds,
  emptyBoard,
  makeScoreBoardFromLandingWeights,
  scoreBoard,
  scoreBoardOldWeights,
  seededPieceKinds,
  simulateAutoplay,
  SURVIVAL_PIECES_PER_SEED,
  type LandingWeightPair,
} from "./tetris-engine";
import { simulateSeededTDrill } from "./tetris-seeded-t-drill";

const MIN_SZ_SURVIVAL = 56;
const MIN_SZ_LINES = 14;

export type BatteryResult = {
  survivalPass: boolean;
  survivalCount: number;
  tDrillPass: boolean;
  tDrillFails: { seed: number; old: number; new: number }[];
  szPass: boolean;
  szLines: number;
  szToppedOut: boolean;
};

export function runThreeBatteries(
  seeds: readonly number[],
  pair: LandingWeightPair,
): BatteryResult {
  const scoreFn = makeScoreBoardFromLandingWeights(pair);
  let survivalCount = 0;
  for (const seed of seeds) {
    const kinds = seededPieceKinds(SURVIVAL_PIECES_PER_SEED, seed);
    if (!simulateAutoplay(emptyBoard(), kinds, scoreFn).toppedOut) survivalCount++;
  }
  const tDrillFails: BatteryResult["tDrillFails"] = [];
  for (const seed of seeds) {
    const old = simulateSeededTDrill(seed, scoreBoardOldWeights).lines;
    const newL = simulateSeededTDrill(seed, scoreFn).lines;
    if (newL < old - 1) tDrillFails.push({ seed, old, new: newL });
  }
  const sz = simulateAutoplay(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL), scoreFn);
  return {
    survivalPass: survivalCount === seeds.length,
    survivalCount,
    tDrillPass: tDrillFails.length === 0,
    tDrillFails,
    szPass: !sz.toppedOut && sz.lines >= MIN_SZ_LINES,
    szLines: sz.lines,
    szToppedOut: sz.toppedOut,
  };
}

/** Simulation cost counter for held-out validation (games × piece locks). */
export function countBatterySimulations(seeds: readonly number[], tDrillPieces: number): {
  survivalGames: number;
  survivalMoves: number;
  tDrillGames: number;
  tDrillMoves: number;
  szGames: number;
  szMoves: number;
  totalGames: number;
  totalMoves: number;
} {
  const survivalGames = seeds.length;
  const survivalMoves = seeds.length * SURVIVAL_PIECES_PER_SEED;
  const tDrillGames = seeds.length;
  const tDrillMoves = seeds.length * tDrillPieces;
  const szGames = 1;
  const szMoves = MIN_SZ_SURVIVAL;
  return {
    survivalGames,
    survivalMoves,
    tDrillGames,
    tDrillMoves,
    szGames,
    szMoves,
    totalGames: survivalGames + tDrillGames + szGames,
    totalMoves: survivalMoves + tDrillMoves + szMoves,
  };
}
