import { afterEach, describe, expect, it } from "vitest";
import type { NetScene } from "../graph/scene";
import { DEMO_DATA_LABEL } from "../core/demo-source";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { TetrisView } from "./tetris";
import { shouldHoldTopout, TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";

const FRAME_MS = 16;
const FRAMES = 600;

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

describe("TetrisView never-empty well", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  function mount(): TetrisHarness {
    clock = 0;
    setVizClockInjector(() => clock);
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "300px";
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });
    document.body.append(host);
    hosts.push(host);
    const view = new TetrisHarness(host, mockScene());
    view.start();
    view.testSetIdleSeed(42);
    view.onPollEmpty();
    return view;
  }

  function hostTick(view: TetrisHarness, dtSec = FRAME_MS / 1000): void {
    clock += FRAME_MS;
    view.hostFrameTick(dtSec);
  }

  it("frame 0: active piece and Demo data label on idle feed", () => {
    const view = mount();
    expect(view.testHasActivePiece()).toBe(true);
    expect(view.controls[1]?.classList.contains("is-visible")).toBe(true);
    expect(view.controls[1]?.textContent).toBe(DEMO_DATA_LABEL);
  });

  it("respawns within one host tick after top-out hold clears the stack", () => {
    const view = mount();
    const t0 = 50;
    view.testOverflowLock(t0);
    const holdUntil = view.testTopoutHoldUntil();
    expect(holdUntil).toBe(t0 + TETRIS_TOPOUT_HOLD_S);
    clock = holdUntil * 1000;
    view.tick(holdUntil + 0.001, 0.001);
    expect(view.testStackCount()).toBe(0);
    expect(view.testLastHoldExpiredAt()).toBe(52.001);
    expect(view.testHasActivePiece()).toBe(true);
  });

  it("every frame outside top-out hold has an active piece (600 idle ticks, seed 42)", () => {
    const view = mount();
    let holdFrames = 0;
    for (let i = 0; i < FRAMES; i++) {
      hostTick(view);
      const now = clock / 1000;
      const inHold = shouldHoldTopout(now, view.testTopoutHoldUntil());
      if (inHold) {
        holdFrames++;
      } else {
        expect(view.testHasActivePiece()).toBe(true);
      }
    }
    expect(holdFrames).toBe(0);
  });
});
