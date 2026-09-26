import { describe, expect, it } from "vitest";
import { shouldHoldTopout, topoutHoldExpired, TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";

describe("tetris top-out hold", () => {
  it("holds the final board for two seconds", () => {
    expect(TETRIS_TOPOUT_HOLD_S).toBe(2);
    const until = 10 + TETRIS_TOPOUT_HOLD_S;
    expect(shouldHoldTopout(10.5, until)).toBe(true);
    expect(shouldHoldTopout(12, until)).toBe(false);
    expect(topoutHoldExpired(12, until)).toBe(true);
    expect(topoutHoldExpired(11.9, until)).toBe(false);
  });
});
