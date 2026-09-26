import { describe, expect, it } from "vitest";
import {
  afterLockStack,
  beginTopoutHoldState,
  isInTopoutHold,
  stepTopoutHold,
  TETRIS_STACK_OVERFLOW_CELLS,
} from "./tetris-overflow";
import { TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";

describe("tetris top-out integration", () => {
  it("holds two seconds after geometric top-out before clearing", () => {
    const t0 = 100;
    let state = beginTopoutHoldState(t0, { stackCells: 40, topoutHoldUntil: 0 });
    expect(isInTopoutHold(t0, state)).toBe(true);
    expect(isInTopoutHold(t0 + TETRIS_TOPOUT_HOLD_S - 0.01, state)).toBe(true);
    expect(stepTopoutHold(t0 + TETRIS_TOPOUT_HOLD_S - 0.01, state).stackCells).toBe(40);
    state = stepTopoutHold(t0 + TETRIS_TOPOUT_HOLD_S, state);
    expect(state.stackCells).toBe(0);
    expect(state.topoutHoldUntil).toBe(0);
    expect(isInTopoutHold(t0 + TETRIS_TOPOUT_HOLD_S, state)).toBe(false);
  });

  it("holds two seconds after stack overflow before clearing", () => {
    const t0 = 50;
    const overflow = TETRIS_STACK_OVERFLOW_CELLS + 1;
    let state = afterLockStack(t0, overflow, 0);
    expect(state.topoutHoldUntil).toBe(t0 + TETRIS_TOPOUT_HOLD_S);
    expect(state.stackCells).toBe(overflow);
    expect(isInTopoutHold(t0 + 1, state)).toBe(true);
    state = stepTopoutHold(t0 + TETRIS_TOPOUT_HOLD_S, state);
    expect(state.stackCells).toBe(0);
  });
});
