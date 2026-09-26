import { describe, expect, it } from "vitest";
import { assertSweepSeed } from "./tetris-seed-guard";

describe("tetris-seed-guard", () => {
  it("rejects seed 20 and above for weight sweeps", () => {
    expect(() => assertSweepSeed(20)).toThrow(/sweep seed must be an integer in \[0, 19\]/);
  });
});
