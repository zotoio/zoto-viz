import { afterEach, describe, expect, it } from "vitest";
import type { NetScene } from "../graph/scene";
import type { Packet } from "../core/types";
import { TetrisView } from "./tetris";
import { TETRIS_IDLE_TOPOUT_SEED } from "./tetris-idle-traffic";
import { TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as NetScene;
}

class TetrisHarness extends TetrisView {
  tick(now: number, dt: number): void {
    this.step(now, dt);
  }
  onPollEmpty(): void {
    this.onTrafficPollEmpty();
  }
}

describe("TetrisView idle feed", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  function mount(): TetrisHarness {
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "300px";
    document.body.append(host);
    hosts.push(host);
    const view = new TetrisHarness(host, mockScene());
    view.testSetIdleSeed(42);
    return view;
  }

  it("spawns pieces and grows the stack within a bounded idle tick budget", () => {
    const view = mount();
    const before = view.testLockedCellCount();
    view.testSimulateIdleSteps(0, 80, 0.25);
    expect(view.testLockedCellCount()).toBeGreaterThan(before);
    expect(view.testUsingIdleFeed()).toBe(true);
  });

  it("hands traffic back to live packets when the poll returns data", () => {
    const view = mount();
    view.onPollEmpty();
    expect(view.testUsingIdleFeed()).toBe(true);
    const live: Packet = [1_700_000_100, "in", "10.0.0.1", "tcp", "443", 128, "eth0", "live", "10.0.0.1:443"];
    view.testIngestLivePackets([live]);
    expect(view.testUsingIdleFeed()).toBe(false);
    view.onPollEmpty();
    expect(view.testUsingIdleFeed()).toBe(true);
  });

  it("replays the same board fingerprint for the same idle seed", () => {
    const a = mount();
    a.testSetIdleSeed(77);
    a.testSimulateIdleSteps(0, 60, 0.2);
    const fa = a.testBoardFingerprint();
    const b = mount();
    b.testSetIdleSeed(77);
    b.testSimulateIdleSteps(0, 60, 0.2);
    expect(b.testBoardFingerprint()).toBe(fa);
  });

  it("reaches top-out hold from the top-out idle seed within a bounded tick budget", () => {
    const view = mount();
    view.testSetIdleSeed(TETRIS_IDLE_TOPOUT_SEED);
    let hold = 0;
    for (let i = 0; i < 120; i++) {
      view.tick(10 + i * 0.2, 0.2);
      hold = view.testTopoutHoldUntil();
      if (hold > 0) break;
    }
    expect(hold).toBeGreaterThan(10);
  });
});
