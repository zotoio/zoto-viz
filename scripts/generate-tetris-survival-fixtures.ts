/**
 * One-off survival battery fixtures for PR #47.
 * Run from repo root: pnpm exec tsx scripts/generate-tetris-survival-fixtures.ts
 *
 * Baselines use the pre-#47 aggregate planner (scoreBoardOldWeights) at main merge base 6520b01.
 */
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SURVIVAL_BATTERY_MAX_PIECES,
  SURVIVAL_BATTERY_SEEDS,
  scoreBoard,
  scoreBoardOldWeights,
  seededPieceKindIds,
  simulateAutoplayTrace,
} from "../web/src/arcade/tetris-engine.ts";
import { emptyBoard } from "../web/src/arcade/tetris-engine.ts";

const MAIN_BASE_SHA = "6520b014472c05f831ac5204429be2affb8473cb";
const scriptPath = fileURLToPath(import.meta.url);
const scriptSource = readFileSync(scriptPath, "utf8");
const generatorScriptSha = createHash("sha256").update(scriptSource).digest("hex");

const seeds = SURVIVAL_BATTERY_SEEDS.map((seed) => {
  const first50KindIds = seededPieceKindIds(50, seed);
  const kindsOld = seededPieceKindIds(SURVIVAL_BATTERY_MAX_PIECES, seed);
  const oldTrace = simulateAutoplayTrace(emptyBoard(), kindsOld, scoreBoardOldWeights);
  const baselinePieces = oldTrace.toppedOut ? oldTrace.pieces : SURVIVAL_BATTERY_MAX_PIECES;
  const kindsNew = seededPieceKindIds(SURVIVAL_BATTERY_MAX_PIECES, seed);
  const newTrace = simulateAutoplayTrace(emptyBoard(), kindsNew, scoreBoard);
  return {
    seed,
    baselinePieces,
    expectedPieces: newTrace.pieces,
    first50KindIds,
    placementsEvaluated: newTrace.placementsEvaluated,
  };
});

const out = {
  mainBaseSha: MAIN_BASE_SHA,
  generatorScriptSha,
  maxPieces: SURVIVAL_BATTERY_MAX_PIECES,
  seedCount: SURVIVAL_BATTERY_SEEDS.length,
  seeds,
};

const outPath = join(dirname(scriptPath), "../web/src/arcade/fixtures/tetris-survival-baseline.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${outPath} (${seeds.length} seeds, script sha256 ${generatorScriptSha.slice(0, 12)}…)`);
