import { describe, expect, it } from "vitest";
import {
  allTKinds,
  alternatingSzKinds,
  bestPlacement,
  cellsFor,
  collides,
  emptyBoard,
  landingHeightForPiece,
  landingY,
  lockCells,
  pieceFitsInWell,
  simulateAutoplay,
  simulateAutoplayLegacy,
  simulateAutoplayOldWeights,
  simulateAutoplayRegressed,
  scoreBoardLegacy,
  scoreBoardRegressed,
  seededPieceKinds,
  survivalRate,
  TETRIS_COLS,
  TETRIS_ROWS,
  TETRIS_SURVIVAL_SEEDS,
  TETRIS_WEIGHTS,
} from "./tetris-engine";
import { normalizeCells, rotateCells } from "./stage-math";
import {
  formatGarbageRows,
  seededTDrillLayoutHash,
  simulateSeededTDrill,
  simulateSeededTDrillOldWeights,
} from "./tetris-seeded-t-drill";
import { allBatterySeeds } from "./tetris-seed-guard";

/** Minimum alternating S/Z pieces the fixed planner must survive on an empty well. */
const MIN_SZ_SURVIVAL = 56;
/** Minimum all-T pieces the fixed planner must survive on an empty well. */
const MIN_T_SURVIVAL = 48;
const SURVIVAL_PIECES = 200;

describe("tetris-engine", () => {
  it("respects walls and rotation when landing", () => {
    const board = emptyBoard();
    const cells = cellsFor("I", 1);
    expect(collides(board, cells, -1, 10)).toBe(true);
    expect(collides(board, cells, TETRIS_COLS, 10)).toBe(true);
    const y = landingY(board, cells, 3);
    expect(y).not.toBeNull();
    expect(collides(board, cells, 3, y!)).toBe(false);
    const rotated = normalizeCells(rotateCells(cells, 1));
    expect(rotated).not.toEqual(cells);
  });

  it("scores landing height on touched columns only", () => {
    const board = emptyBoard();
    for (let x = 0; x < 6; x++) board[0]![x] = true;
    const cells = cellsFor("O", 0);
    const landed = landingHeightForPiece(board, cells, 2);
    expect(landed).toBe(2);
    expect(TETRIS_WEIGHTS.pieceLandingHeight).toBeCloseTo(-0.4, 1);
  });

  it("clears a full row on a seeded sequence", () => {
    const kinds = seededPieceKinds(24, 42);
    const { lines, toppedOut } = simulateAutoplay(emptyBoard(), kinds);
    expect(toppedOut).toBe(false);
    expect(lines).toBeGreaterThan(0);
  });

  it("matches legacy survival on a fixed seed battery", { timeout: 120_000 }, () => {
    const legacy = survivalRate(TETRIS_SURVIVAL_SEEDS, SURVIVAL_PIECES, scoreBoardLegacy);
    const fixed = survivalRate(TETRIS_SURVIVAL_SEEDS, SURVIVAL_PIECES);
    expect(fixed).toBeGreaterThanOrEqual(legacy);
    expect(legacy).toBe(59);
    expect(fixed).toBe(59);
  });

  it("picks a legal placement for each rotation", () => {
    const board = emptyBoard();
    const plan = bestPlacement(board, "T");
    expect(plan).not.toBeNull();
    const cells = cellsFor("T", plan!.rot);
    expect(landingY(board, cells, plan!.x)).toBe(plan!.y);
  });

  // Seeded T drill: garbage rows + first-piece spawn column vary per survival seed; 48× T.
  // Per-seed old vs new comparison uses scoreBoardOldWeights (test-only reference). See PR #47.
  // Landing-weight sweep grid (seeds 0–19 only): scripts/tetris-weight-sweep.ts — table in PR body.
  // Empty-well 18+ lines on the fixed planner still breaks 20/20 survival (aggregate height dominates).
  it("seeded T drill: new planner within one line of old weights on every survival seed", { timeout: 120_000 }, () => {
    for (const seed of TETRIS_SURVIVAL_SEEDS) {
      const oldLines = simulateSeededTDrillOldWeights(seed).lines;
      const newLines = simulateSeededTDrill(seed).lines;
      if (newLines < oldLines - 1) {
        expect.fail(`seed ${seed}: new=${newLines} old=${oldLines} (need new >= old - 1)`);
      }
    }
  });

  it("seeded T drill layouts differ across survival seeds", () => {
    const hashes = allBatterySeeds().map((seed) => seededTDrillLayoutHash(seed));
    expect(new Set(hashes).size).toBeGreaterThanOrEqual(18);
  });

  it("survives long S/Z and T-only sequences with line clears", () => {
    const sz = simulateAutoplay(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    expect(sz.toppedOut).toBe(false);
    expect(sz.pieces).toBe(MIN_SZ_SURVIVAL);
    expect(sz.lines).toBeGreaterThanOrEqual(14);

    const t = simulateAutoplay(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(t.toppedOut).toBe(false);
    expect(t.pieces).toBe(MIN_T_SURVIVAL);
    expect(t.lines).toBeGreaterThanOrEqual(17);
  });

  it("reports top-out when the well has no in-bounds placement", () => {
    const board = emptyBoard();
    for (let x = 0; x < TETRIS_COLS; x++) {
      for (let y = 0; y < TETRIS_ROWS; y++) board[y]![x] = true;
    }
    expect(bestPlacement(board, "T")).toBeNull();
    const cells = cellsFor("O", 0);
    expect(pieceFitsInWell(cells, 0, TETRIS_ROWS, TETRIS_ROWS)).toBe(false);
    expect(landingY(board, cells, 0)).toBeNull();
    const topped = simulateAutoplay(board, ["T"]);
    expect(topped.toppedOut).toBe(true);
    expect(topped.pieces).toBe(0);
  });

  it("beats the old mis-tuned landing weights on S/Z and T sequences", () => {
    const szLegacy = simulateAutoplayLegacy(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    const szOld = simulateAutoplayOldWeights(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    const szFixed = simulateAutoplay(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    expect(szOld.lines).toBeLessThan(szFixed.lines);
    expect(szFixed.lines).toBeGreaterThanOrEqual(14);
    expect(szLegacy.toppedOut).toBe(true);
    expect(szLegacy.lines).toBeLessThanOrEqual(4);

    const tOld = simulateAutoplayOldWeights(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    const tFixed = simulateAutoplay(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(tOld.lines).toBeLessThan(tFixed.lines);
    expect(tFixed.lines).toBeGreaterThanOrEqual(17);
    const tRegressed = simulateAutoplayRegressed(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(tRegressed.lines).toBeGreaterThanOrEqual(18);
  });

  it("regressed piece-only planner survives fewer seeded runs than the fixed planner", { timeout: 120_000 }, () => {
    const regressed = survivalRate(TETRIS_SURVIVAL_SEEDS, SURVIVAL_PIECES, scoreBoardRegressed);
    const fixed = survivalRate(TETRIS_SURVIVAL_SEEDS, SURVIVAL_PIECES);
    expect(regressed).toBeLessThanOrEqual(12);
    expect(fixed).toBe(59);
    expect(regressed).toBeLessThan(fixed);
  });
});
