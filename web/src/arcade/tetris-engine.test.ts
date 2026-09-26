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
  simulateAutoplay,
  simulateAutoplayLegacy,
  seededPieceKinds,
  TETRIS_COLS,
  TETRIS_WEIGHTS,
} from "./tetris-engine";
import { normalizeCells, rotateCells } from "./stage-math";

/** Minimum alternating S/Z pieces the fixed planner must survive on an empty well. */
const MIN_SZ_SURVIVAL = 56;
/** Minimum all-T pieces the fixed planner must survive on an empty well. */
const MIN_T_SURVIVAL = 48;

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
    expect(TETRIS_WEIGHTS.landingHeight).toBeCloseTo(-4.913486);
  });

  it("clears a full row on a seeded sequence", () => {
    const kinds = seededPieceKinds(24, 42);
    const { lines, toppedOut } = simulateAutoplay(emptyBoard(), kinds);
    expect(toppedOut).toBe(false);
    expect(lines).toBeGreaterThan(0);
  });

  it("survives ~200 seeded pieces without topping out", () => {
    const kinds = seededPieceKinds(200, 7);
    const { toppedOut, lines, pieces } = simulateAutoplay(emptyBoard(), kinds);
    expect(toppedOut).toBe(false);
    expect(pieces).toBe(200);
    expect(lines).toBeGreaterThan(0);
  });

  it("picks a legal placement for each rotation", () => {
    const board = emptyBoard();
    const plan = bestPlacement(board, "T");
    expect(plan).not.toBeNull();
    const cells = cellsFor("T", plan!.rot);
    expect(landingY(board, cells, plan!.x)).toBe(plan!.y);
  });

  it("survives long S/Z and T-only sequences with line clears", () => {
    const sz = simulateAutoplay(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    expect(sz.toppedOut).toBe(false);
    expect(sz.pieces).toBe(MIN_SZ_SURVIVAL);
    expect(sz.lines).toBeGreaterThanOrEqual(14);

    const t = simulateAutoplay(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(t.toppedOut).toBe(false);
    expect(t.pieces).toBe(MIN_T_SURVIVAL);
    expect(t.lines).toBeGreaterThanOrEqual(18);
  });

  it("fails the old aggregate-height landing weight on S/Z and T sequences", () => {
    const szLegacy = simulateAutoplayLegacy(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    const szFixed = simulateAutoplay(emptyBoard(), alternatingSzKinds(MIN_SZ_SURVIVAL));
    expect(szLegacy.lines).toBeLessThan(4);
    expect(szFixed.lines).toBeGreaterThanOrEqual(14);

    const tLegacy = simulateAutoplayLegacy(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    const tFixed = simulateAutoplay(emptyBoard(), allTKinds(MIN_T_SURVIVAL));
    expect(tLegacy.lines).toBeLessThan(4);
    expect(tFixed.lines).toBeGreaterThanOrEqual(18);
  });
});
