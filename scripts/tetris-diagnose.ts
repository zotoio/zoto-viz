import {
  boardToAscii,
  finalBoardForSeededTDrill,
  findFirstPlannerDivergence,
  findFirstSurvivalGameDivergence,
  simulateSeededTDrill,
  simulateSeededTDrillOldWeights,
} from "../web/src/arcade/tetris-seeded-t-drill.ts";
import {
  emptyBoard,
  scoreBoard,
  scoreBoardOldWeights,
  seededPieceKinds,
  simulateAutoplay,
  SURVIVAL_PIECES_PER_SEED,
} from "../web/src/arcade/tetris-engine.ts";
import { tuningSeeds } from "../web/src/arcade/tetris-seed-guard.ts";

for (const seed of [5, 6, 11]) {
  console.log(`\n=== SEED ${seed} OLD (${simulateSeededTDrillOldWeights(seed).lines} lines) ===`);
  console.log(boardToAscii(finalBoardForSeededTDrill(seed, scoreBoardOldWeights)));
  console.log(`\n=== SEED ${seed} NEW (${simulateSeededTDrill(seed).lines} lines) ===`);
  console.log(boardToAscii(finalBoardForSeededTDrill(seed)));
}

const div6 = findFirstPlannerDivergence(6);
console.log("\n=== SEED 6 T-drill first divergence ===");
console.log(JSON.stringify(div6, null, 2));

const div5 = findFirstSurvivalGameDivergence(5);
console.log("\n=== SEED 5 survival-game (200 pc) first divergence ===");
console.log(JSON.stringify(div5, null, 2));

let oldLines = 0;
let newLines = 0;
for (const seed of tuningSeeds()) {
  const kinds = seededPieceKinds(SURVIVAL_PIECES_PER_SEED, seed);
  oldLines += simulateAutoplay(emptyBoard(), kinds, scoreBoardOldWeights).lines;
  newLines += simulateAutoplay(emptyBoard(), kinds, scoreBoard).lines;
}
console.log(`\n=== Survival tuning seeds 0–19: total lines new=${newLines} old=${oldLines} ===`);
const k5 = seededPieceKinds(SURVIVAL_PIECES_PER_SEED, 5);
console.log(
  `seed 5 lines: new=${simulateAutoplay(emptyBoard(), k5, scoreBoard).lines} old=${simulateAutoplay(emptyBoard(), k5, scoreBoardOldWeights).lines}`,
);
