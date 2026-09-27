import type { Packet } from "../core/types";
import { POLL_MS } from "./arcade";
import {
  hostIdleFixturePackets,
  hostIdlePacketsDueByMs,
} from "../plugins/fixtures/host-idle-traffic";

/** After live traffic, wait one poll interval before idle pieces resume. */
export const TETRIS_LIVE_QUIET_MS = POLL_MS;

/**
 * Single host-idle packet scheduler driven by {@link vizClockMs} (not rAF `now`).
 * Produces zero packets while live traffic is active or inside the quiet window.
 */
export class TetrisIdleScheduler {
  private seed: number;
  private originMs: number;
  private acknowledgedDue = 0;
  private liveUntilMs = 0;

  constructor(seed: number, originMs: number) {
    this.seed = seed >>> 0;
    this.originMs = originMs;
  }

  get quietUntilMs(): number {
    return this.liveUntilMs;
  }

  isLiveExclusive(clockMs: number): boolean {
    return clockMs < this.liveUntilMs;
  }

  noteLiveTraffic(clockMs: number): void {
    this.liveUntilMs = clockMs + TETRIS_LIVE_QUIET_MS;
  }

  notePollEmpty(clockMs: number): void {
    if (clockMs >= this.liveUntilMs) return;
    // still inside quiet window after live
  }

  /** Host-idle packets newly due since the last tick (empty while live-exclusive). */
  tick(clockMs: number): Packet[] {
    if (this.isLiveExclusive(clockMs)) return [];
    const elapsed = Math.max(0, clockMs - this.originMs);
    const totalDue = hostIdlePacketsDueByMs(elapsed);
    const delta = totalDue - this.acknowledgedDue;
    if (delta <= 0) return [];
    const packets = hostIdleFixturePackets(this.acknowledgedDue, delta, this.seed);
    this.acknowledgedDue = totalDue;
    return packets;
  }

  reset(seed: number, originMs: number): void {
    this.seed = seed >>> 0;
    this.originMs = originMs;
    this.acknowledgedDue = 0;
    this.liveUntilMs = 0;
  }

  /** TEST-ONLY: force quiet window elapsed. */
  testClearLiveQuiet(clockMs: number): void {
    this.liveUntilMs = clockMs;
  }
}
