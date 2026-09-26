import {
  allTKinds,
  bestPlacement,
  cellsFor,
  clearFullRows,
  cloneBoard,
  emptyBoard,
  landingY,
  lockCells,
  scoreBoard,
  scoreBoardOldWeights,
  type Board,
  TETRIS_COLS,
  T_DRILL_PIECES,
} from "./tetris-engine";

/** FNV-1a-style mix for deterministic drill parameters from the survival seed. */
export function seededTDrillU32(seed: number, tag: number): number {
  let h = 2166136261 ^ (seed >>> 0);
  h = Math.imul(h ^ tag, 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return h >>> 0;
}

export type SeededTDrillLayout = {
  seed: number;
  garbageRows: number;
  /** Hole column per garbage row (index 0 = bottom row). */
  holeColumns: number[];
  startColumn: number;
};

export function seededTDrillLayout(seed: number): SeededTDrillLayout {
  const garbageRows = 2 + (seededTDrillU32(seed, 0) % 3);
  const holeColumns: number[] = [];
  for (let r = 0; r < garbageRows; r++) {
    holeColumns.push(seededTDrillU32(seed, 1 + r) % TETRIS_COLS);
  }
  const startColumn = seededTDrillU32(seed, 50) % TETRIS_COLS;
  return { seed, garbageRows, holeColumns, startColumn };
}

export function boardForSeededTDrill(layout: SeededTDrillLayout): Board {
  const board = emptyBoard();
  for (let r = 0; r < layout.garbageRows; r++) {
    const y = r;
    const hole = layout.holeColumns[r]!;
    for (let x = 0; x < TETRIS_COLS; x++) {
      if (x !== hole) board[y]![x] = true;
    }
  }
  return board;
}

/** Stable hash of garbage + start column (for board-variety regression). */
export function seededTDrillLayoutHash(seed: number): string {
  const layout = seededTDrillLayout(seed);
  return `${layout.garbageRows}:${layout.holeColumns.join(",")}:${layout.startColumn}`;
}

export function formatGarbageRows(layout: SeededTDrillLayout): string {
  return layout.holeColumns.map((h, i) => `r${i} hole@${h}`).join(", ");
}

type ScoreFn = typeof scoreBoard;

function bestPlacementAtSpawnColumn(
  board: Board,
  kind: string,
  spawnColumn: number,
  scoreFn: ScoreFn,
): ReturnType<typeof bestPlacement> {
  let best: ReturnType<typeof bestPlacement> = null;
  let bestScore = -Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const cells = cellsFor(kind, rot);
    const minCx = Math.min(...cells.map(([cx]) => cx));
    const maxCx = Math.max(...cells.map(([cx]) => cx));
    const x = spawnColumn - minCx;
    if (x < 0 || x + maxCx >= TETRIS_COLS) continue;
    const y = landingY(board, cells, x);
    if (y === null) continue;
    const trial = cloneBoard(board);
    lockCells(trial, cells, x, y);
    const cleared = clearFullRows(trial);
    const score = scoreFn(trial, cleared, cells.length, { cells, x });
    if (score > bestScore) {
      bestScore = score;
      best = { x, y, rot };
    }
  }
  return best;
}

export function simulateSeededTDrill(
  seed: number,
  scoreFn: ScoreFn = scoreBoard,
): { lines: number; toppedOut: boolean; layout: SeededTDrillLayout } {
  const layout = seededTDrillLayout(seed);
  const board = boardForSeededTDrill(layout);
  const kinds = allTKinds(T_DRILL_PIECES);
  let lines = 0;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    const plan = i === 0
      ? bestPlacementAtSpawnColumn(board, kind, layout.startColumn, scoreFn)
      : bestPlacement(board, kind, scoreFn);
    if (!plan) return { lines, toppedOut: true, layout };
    const cells = cellsFor(kind, plan.rot);
    lockCells(board, cells, plan.x, plan.y);
    lines += clearFullRows(board);
  }
  return { lines, toppedOut: false, layout };
}

/** TEST-ONLY reference planner (`scoreBoardOldWeights`); not used in production autoplay. */
export function simulateSeededTDrillOldWeights(seed: number): ReturnType<typeof simulateSeededTDrill> {
  return simulateSeededTDrill(seed, scoreBoardOldWeights);
}
