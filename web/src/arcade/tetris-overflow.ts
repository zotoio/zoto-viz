import { shouldHoldTopout, topoutHoldExpired, TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";

export const TETRIS_STACK_OVERFLOW_CELLS = 80;

export type TetrisHoldState = {
  stackCells: number;
  topoutHoldUntil: number;
};

export function beginTopoutHoldState(now: number, state: TetrisHoldState): TetrisHoldState {
  if (state.topoutHoldUntil > 0) return state;
  return { ...state, topoutHoldUntil: now + TETRIS_TOPOUT_HOLD_S };
}

/** Advance simulated clock; clears the stack after the hold window expires. */
export function stepTopoutHold(now: number, state: TetrisHoldState): TetrisHoldState {
  if (topoutHoldExpired(now, state.topoutHoldUntil)) {
    return { stackCells: 0, topoutHoldUntil: 0 };
  }
  return state;
}

export function isInTopoutHold(now: number, state: TetrisHoldState): boolean {
  return shouldHoldTopout(now, state.topoutHoldUntil);
}

/** After locking cells, start the visible hold when the stack exceeds the overflow threshold. */
export function afterLockStack(now: number, stackCells: number, topoutHoldUntil: number): TetrisHoldState {
  const base = { stackCells, topoutHoldUntil };
  if (stackCells > TETRIS_STACK_OVERFLOW_CELLS) return beginTopoutHoldState(now, base);
  return base;
}
