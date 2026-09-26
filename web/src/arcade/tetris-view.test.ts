import { afterEach, describe, expect, it } from "vitest";
import type { NetScene } from "../graph/scene";
import { TetrisView } from "./tetris";
import { TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";
import { TETRIS_STACK_OVERFLOW_CELLS } from "./tetris-overflow";

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as NetScene;
}

class TetrisHarness extends TetrisView {
  tick(now: number, dt: number): void {
    this.step(now, dt);
  }
}

describe("TetrisView overflow hold", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("keeps the stack visible for two seconds after geometric overflow before clearing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const view = new TetrisHarness(host, mockScene());
    const t0 = 100;
    view.testOverflowLock(t0);
    expect(view.testStackCount()).toBeGreaterThan(TETRIS_STACK_OVERFLOW_CELLS);
    expect(view.testTopoutHoldUntil()).toBe(t0 + TETRIS_TOPOUT_HOLD_S);
    view.tick(t0 + 0.5, 0.5);
    expect(view.testStackCount()).toBeGreaterThan(TETRIS_STACK_OVERFLOW_CELLS);
    view.tick(t0 + TETRIS_TOPOUT_HOLD_S - 0.1, TETRIS_TOPOUT_HOLD_S - 0.6);
    expect(view.testStackCount()).toBeGreaterThan(0);
    view.tick(t0 + TETRIS_TOPOUT_HOLD_S + 0.1, 0.2);
    expect(view.testStackCount()).toBe(0);
  });
});
