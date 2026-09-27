import { describe, expect, it } from "vitest";
import {
  hostIdleFixturePacket,
  hostIdleFixturePps,
  hostIdlePacketsDueByMs,
  parseTetrisIdleSeedFromSearch,
  TETRIS_IDLE_TOPOUT_SEED,
} from "./host-idle-traffic";
import { goldenLanFixture } from "./golden-lan-state";

describe("host-idle-traffic", () => {
  it("uses the golden host fixture pkt/s for scheduling", () => {
    expect(hostIdleFixturePps()).toBe(goldenLanFixture().stats.pps);
    expect(hostIdleFixturePps()).toBe(420);
  });

  it("parses top-out idle seed aliases", () => {
    expect(parseTetrisIdleSeedFromSearch("?tetrisIdle=topout")).toBe(TETRIS_IDLE_TOPOUT_SEED);
    expect(parseTetrisIdleSeedFromSearch("?tetrisIdleSeed=12")).toBe(12);
  });

  it("derives cumulative packet counts from clock ms", () => {
    expect(hostIdlePacketsDueByMs(0)).toBe(0);
    expect(hostIdlePacketsDueByMs(1000)).toBe(420);
    expect(hostIdlePacketsDueByMs(2500)).toBe(1050);
  });

  it("builds deterministic packets from golden flows", () => {
    const a = hostIdleFixturePacket(0, 42);
    const b = hostIdleFixturePacket(0, 42);
    const c = hostIdleFixturePacket(1, 42);
    expect(a).toEqual(b);
    expect(a[3]).toBeTruthy();
    expect(c[2]).toBeTruthy();
    expect(a[7]).toBe("golden");
  });
});
