import {
  boardToAscii,
  finalBoardForSeededTDrill,
  findFirstPlannerDivergence,
  simulateSeededTDrill,
  simulateSeededTDrillOldWeights,
} from "../web/src/arcade/tetris-seeded-t-drill.ts";
import { scoreBoardOldWeights } from "../web/src/arcade/tetris-engine.ts";

for (const seed of [5, 6, 11]) {
  console.log(`\n=== SEED ${seed} OLD (${simulateSeededTDrillOldWeights(seed).lines} lines) ===`);
  console.log(boardToAscii(finalBoardForSeededTDrill(seed, scoreBoardOldWeights)));
  console.log(`\n=== SEED ${seed} NEW (${simulateSeededTDrill(seed).lines} lines) ===`);
  console.log(boardToAscii(finalBoardForSeededTDrill(seed)));
}

const div = findFirstPlannerDivergence(6);
console.log("\n=== SEED 6 first divergence ===");
console.log(JSON.stringify(div, null, 2));
