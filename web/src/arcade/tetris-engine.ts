import { normalizeCells, rotateCells, TETROMINOES, tetrominoForProto } from "./stage-math";

export const TETRIS_COLS = 10;
export const TETRIS_ROWS = 16;

export type Board = boolean[][];

/** Dellacherie-style feature weights (landing height, lines, holes, bumpiness, transitions). */
export const TETRIS_WEIGHTS = {
  /** Sum of column heights touched by the piece (not full-board aggregate). */
  landingHeight: -4.913486,
  erodedPieceCells: 1.0,
  rowTransitions: -3.0,
  colTransitions: -3.0,
  holes: -7.0,
  wells: -3.5,
  bumpiness: -2.0,
} as const;

export type Placement = { x: number; y: number; rot: number };

export function emptyBoard(cols = TETRIS_COLS, rows = TETRIS_ROWS): Board {
  return Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

export function cellsFor(kind: string, rot: number): [number, number][] {
  const base = TETROMINOES[kind] ?? TETROMINOES.T!;
  return normalizeCells(rotateCells(base, rot));
}

export function pieceFitsInWell(
  cells: [number, number][],
  x: number,
  y: number,
  rows = TETRIS_ROWS,
): boolean {
  for (const [cx, cy] of cells) {
    const py = y + cy;
    if (py < 0 || py >= rows) return false;
  }
  return true;
}

export function collides(board: Board, cells: [number, number][], x: number, y: number): boolean {
  const cols = board[0]?.length ?? TETRIS_COLS;
  const rows = board.length;
  for (const [cx, cy] of cells) {
    const px = x + cx;
    const py = y + cy;
    if (px < 0 || px >= cols || py < 0) return true;
    if (py >= rows) continue;
    if (board[py]![px]) return true;
  }
  return false;
}

/** Lowest y where `cells` at column `x` rest without intersecting filled cells. */
export function landingY(board: Board, cells: [number, number][], x: number): number | null {
  let y = TETRIS_ROWS;
  while (y >= 0) {
    if (!collides(board, cells, x, y)) break;
    y--;
  }
  if (y < 0) return null;
  while (y > 0 && !collides(board, cells, x, y - 1)) y--;
  if (!pieceFitsInWell(cells, x, y, board.length)) return null;
  return y;
}

export function lockCells(board: Board, cells: [number, number][], x: number, y: number): void {
  for (const [cx, cy] of cells) {
    const px = x + cx;
    const py = y + cy;
    if (py >= 0 && py < board.length && px >= 0 && px < board[0]!.length) board[py]![px] = true;
  }
}

export function clearFullRows(board: Board): number {
  const cols = board[0]?.length ?? TETRIS_COLS;
  let cleared = 0;
  for (let y = 0; y < board.length; y++) {
    if (board[y]!.every((c) => c)) {
      board.splice(y, 1);
      board.push(Array<boolean>(cols).fill(false));
      cleared++;
      y--;
    }
  }
  return cleared;
}

function columnHeights(board: Board): number[] {
  const cols = board[0]?.length ?? TETRIS_COLS;
  const h = Array<number>(cols).fill(0);
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < cols; x++) {
      if (board[y]![x]) h[x] = y + 1;
    }
  }
  return h;
}

function aggregateHeight(board: Board): number {
  return columnHeights(board).reduce((a, b) => a + b, 0);
}

/** Heights of columns the locked piece occupies (Dellacherie landing height). */
export function landingHeightForPiece(board: Board, cells: [number, number][], x: number): number {
  const h = columnHeights(board);
  const cols = new Set<number>();
  for (const [cx] of cells) cols.add(x + cx);
  let sum = 0;
  for (const c of cols) sum += h[c]!;
  return sum;
}

function holes(board: Board): number {
  const cols = board[0]?.length ?? TETRIS_COLS;
  let n = 0;
  for (let x = 0; x < cols; x++) {
    let blocked = false;
    for (let y = board.length - 1; y >= 0; y--) {
      if (board[y]![x]) blocked = true;
      else if (blocked) n++;
    }
  }
  return n;
}

function bumpiness(board: Board): number {
  const h = columnHeights(board);
  let b = 0;
  for (let i = 0; i < h.length - 1; i++) b += Math.abs(h[i]! - h[i + 1]!);
  return b;
}

function rowTransitions(board: Board): number {
  let t = 0;
  for (const row of board) {
    let prev = true;
    for (const cell of row) {
      if (cell !== prev) t++;
      prev = cell;
    }
    if (!prev) t++;
  }
  return t;
}

function colTransitions(board: Board): number {
  const cols = board[0]?.length ?? TETRIS_COLS;
  let t = 0;
  for (let x = 0; x < cols; x++) {
    let prev = true;
    for (let y = 0; y < board.length; y++) {
      const cell = board[y]![x]!;
      if (cell !== prev) t++;
      prev = cell;
    }
    if (!prev) t++;
  }
  return t;
}

function wells(board: Board): number {
  const h = columnHeights(board);
  let w = 0;
  for (let i = 0; i < h.length; i++) {
    const left = i === 0 ? h[i]! : h[i - 1]!;
    const right = i === h.length - 1 ? h[i]! : h[i + 1]!;
    const well = Math.max(0, Math.min(left, right) - h[i]!);
    w += well * well;
  }
  return w;
}

function erodedPieceCells(cleared: number, pieceCells: number): number {
  return cleared * pieceCells;
}

export type ScoreContext = { cells: [number, number][]; x: number };

/** @internal Legacy scoring used full-board aggregate height with the landing-height weight. */
export function scoreBoardLegacy(
  board: Board,
  cleared: number,
  pieceCells: number,
  _ctx?: ScoreContext,
): number {
  const w = TETRIS_WEIGHTS;
  return (
    -4.0 * aggregateHeight(board)
    + w.erodedPieceCells * erodedPieceCells(cleared, pieceCells)
    + w.rowTransitions * rowTransitions(board)
    + w.colTransitions * colTransitions(board)
    + w.holes * holes(board)
    + w.wells * wells(board)
    + w.bumpiness * bumpiness(board)
  );
}

export function scoreBoard(
  board: Board,
  cleared: number,
  pieceCells: number,
  ctx: ScoreContext,
): number {
  const w = TETRIS_WEIGHTS;
  return (
    w.landingHeight * landingHeightForPiece(board, ctx.cells, ctx.x)
    + w.erodedPieceCells * erodedPieceCells(cleared, pieceCells)
    + w.rowTransitions * rowTransitions(board)
    + w.colTransitions * colTransitions(board)
    + w.holes * holes(board)
    + w.wells * wells(board)
    + w.bumpiness * bumpiness(board)
  );
}

export function bestPlacement(
  board: Board,
  kind: string,
  scoreFn: typeof scoreBoard = scoreBoard,
): Placement | null {
  let best: Placement | null = null;
  let bestScore = -Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const cells = cellsFor(kind, rot);
    const maxX = TETRIS_COLS - 1 - Math.max(...cells.map(([x]) => x));
    for (let x = 0; x <= maxX; x++) {
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
  }
  return best;
}

export function boardFromOccupied(
  occupied: { x: number; y: number }[],
  cols = TETRIS_COLS,
  rows = TETRIS_ROWS,
): Board {
  const b = emptyBoard(cols, rows);
  for (const { x, y } of occupied) {
    if (y >= 0 && y < rows && x >= 0 && x < cols) b[y]![x] = true;
  }
  return b;
}

export function seededPieceKinds(n: number, salt = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(tetrominoForProto(`tetris-seed:${salt}:${i}`));
  return out;
}

/** Headless autoplay: lock each piece at the planner's best spot. Returns total lines cleared. */
export function simulateAutoplay(
  board: Board,
  kinds: string[],
  scoreFn: typeof scoreBoard = scoreBoard,
): { lines: number; toppedOut: boolean; pieces: number } {
  let lines = 0;
  let pieces = 0;
  for (const kind of kinds) {
    const plan = bestPlacement(board, kind, scoreFn);
    if (!plan) return { lines, toppedOut: true, pieces };
    const cells = cellsFor(kind, plan.rot);
    lockCells(board, cells, plan.x, plan.y);
    lines += clearFullRows(board);
    pieces++;
  }
  return { lines, toppedOut: false, pieces };
}

export function simulateAutoplayLegacy(board: Board, kinds: string[]): ReturnType<typeof simulateAutoplay> {
  return simulateAutoplay(board, kinds, scoreBoardLegacy);
}

/** Fixed-length alternating S/Z or all-T sequences for regression tests. */
export function alternatingSzKinds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i % 2 ? "Z" : "S"));
}

export function allTKinds(n: number): string[] {
  return Array.from({ length: n }, () => "T");
}
