import { describe, expect, it } from "vitest";
import {
  parseTetrisIdleSeedFromSearch,
  tetrisIdlePackets,
  TETRIS_IDLE_TOPOUT_SEED,
} from "./tetris-idle-traffic";

describe("tetris-idle-traffic", () => {
  it("parses tetrisIdleSeed from the query string", () => {
    expect(parseTetrisIdleSeedFromSearch("?tetrisIdleSeed=7")).toBe(7);
    expect(parseTetrisIdleSeedFromSearch("?tetrisIdle=topout")).toBe(TETRIS_IDLE_TOPOUT_SEED);
  });

  it("emits deterministic packets for the same seed and tick", () => {
    const a = tetrisIdlePackets(99, 12);
    const b = tetrisIdlePackets(99, 12);
    expect(a).toEqual(b);
    expect(a[0]![3]).toBeTruthy();
  });
});
