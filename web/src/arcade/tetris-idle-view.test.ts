import { afterEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "../graph/scene";
import type { Packet } from "../core/types";
import { DEMO_DATA_LABEL, DEMO_DATA_SOURCE } from "../core/demo-source";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import type { FrameTs } from "../core/time-ms";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { hostIdlePacketsDueByMs, TETRIS_IDLE_TOPOUT_SEED } from "../plugins/fixtures/host-idle-traffic";
import { withGoldenIfIdle } from "../plugins/fixtures/golden-state";
import { TetrisView } from "./tetris";
import { tickTetrisIdleFeed } from "./tetris-idle-feed";
import { TETRIS_LIVE_QUIET_MS, TetrisIdleScheduler } from "./tetris-idle-scheduler";
import { TETRIS_TOPOUT_HOLD_S } from "./tetris-topout";
import { VIZ_WALL_BUDGET_TICKS } from "../plugins/viz-tile-constants";
import { bindTetrisStandaloneHost } from "./tetris-standalone-host";
import { TETRIS_MAX_PACKETS_PER_FRAME, TetrisTrafficBudget } from "./tetris-traffic-budget";

const FRAME_MS = 16;
const FRAMES = 600;
// 600 × 16 ms = 9600 ms wall on the injected viz clock; fixture is 420 pkt/s → floor(9.6 × 420) = 4032 due.
const CLOCK_END_MS = FRAMES * FRAME_MS;
const DUE_PACKETS = hostIdlePacketsDueByMs(CLOCK_END_MS);
const DELIVER_CAP = FRAMES * TETRIS_MAX_PACKETS_PER_FRAME;

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

describe("TetrisView host idle feed", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;

  afterEach(() => {
    resetVizClockInjectors();
    vi.restoreAllMocks();
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

  function advanceFrames(view: TetrisHarness, frames: number, clockStepMs = FRAME_MS): void {
    let prev = clock;
    for (let i = 0; i < frames; i++) {
      clock += clockStepMs;
      const dtSec = (clock - prev) / 1000;
      prev = clock;
      view.hostFrameTick(clock as FrameTs, dtSec);
    }
  }

  it("spawns pieces and grows the stack within a bounded idle tick budget", () => {
    const view = mount();
    const before = view.testLockedCellCount();
    advanceFrames(view, 60, 200);
    expect(view.testLockedCellCount()).toBeGreaterThan(before);
    expect(view.testUsingIdleFeed()).toBe(true);
    expect(view.controls[1]?.textContent).toBe(DEMO_DATA_LABEL);
  });

  it("matches header packet count on the host idle fixture", () => {
    const view = mount();
    advanceFrames(view, FRAMES);
    const headerDue = hostIdlePacketsDueByMs(CLOCK_END_MS);
    expect(view.testDeliveredPackets()).toBe(Math.min(headerDue, DELIVER_CAP));
    const merged = withGoldenIfIdle({ type: "state", ts: 0, devices: [], flows: [], stats: goldenLanFixture().stats } as never, { fixture: "host" });
    expect(merged.stats.pps).toBe(420);
    expect(DEMO_DATA_SOURCE).toBe("idle: fixture: host");
  });

  it("600 frames: piece budget, no real clock reads, HUD skips match hand count", () => {
    const view = mount();
    const sceneEl = document.createElement("div");
    sceneEl.style.width = "640px";
    sceneEl.style.height = "480px";
    Object.defineProperty(sceneEl, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(sceneEl, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(sceneEl);
    hosts.push(sceneEl);
    const graph = new NetScene(sceneEl);
    bindTetrisStandaloneHost(graph, view);
    graph.testResetGraphRenderCount();
    const nowSpy = vi.spyOn(Date, "now");
    const perfSpy = vi.spyOn(performance, "now");
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");
    nowSpy.mockClear();
    perfSpy.mockClear();
    rafSpy.mockClear();
    expect(view.testTrafficBudget().shareTicks).toBe(VIZ_WALL_BUDGET_TICKS);
    const beforePieces = view.testScore();
    for (let i = 0; i < FRAMES; i++) {
      clock += FRAME_MS;
      graph.testIdleHostFrame(clock);
    }
    expect(nowSpy).not.toHaveBeenCalled();
    expect(perfSpy).not.toHaveBeenCalled();
    expect(rafSpy).not.toHaveBeenCalled();
    expect(graph.testGraphRenderCount()).toBe(0);
    const delivered = view.testDeliveredPackets();
    const expectedDelivered = Math.min(DUE_PACKETS, DELIVER_CAP);
    const expectedSkips = Math.max(0, DUE_PACKETS - expectedDelivered);
    expect(delivered).toBe(expectedDelivered);
    expect(view.testHudSkips()).toBe(expectedSkips);
    expect(view.testRecordCount()).toBe(DUE_PACKETS);
    expect(view.testHudSkipLine()).toMatch(/^skips /);
    expect(view.testScore()).toBeGreaterThan(beforePieces);
  });

  it("hands traffic back to live packets when the poll returns data", () => {
    const view = mount();
    advanceFrames(view, 20);
    const idleDelivered = view.testDeliveredPackets();
    const live: Packet = [1_700_000_100, "in", "10.0.0.1", "tcp", "443", 128, "eth0", "live", "10.0.0.1:443"];
    view.testIngestLivePackets([live]);
    expect(view.testUsingIdleFeed()).toBe(false);
    expect(view.controls[1]?.classList.contains("is-visible")).toBe(false);
    const deliveredAtLive = view.testDeliveredPackets();
    advanceFrames(view, 40);
    expect(view.testDeliveredPackets()).toBe(deliveredAtLive);
    clock += TETRIS_LIVE_QUIET_MS + 1;
    view.onPollEmpty();
    advanceFrames(view, 30);
    expect(view.testDeliveredPackets()).toBeGreaterThan(deliveredAtLive);
    expect(view.controls[1]?.classList.contains("is-visible")).toBe(true);
    expect(view.testDeliveredPackets()).toBeGreaterThan(idleDelivered);
  });

  it("replays the same board fingerprint for the same idle seed", () => {
    const a = mount();
    a.testSetIdleSeed(77);
    advanceFrames(a, 60);
    const fa = a.testBoardFingerprint();
    const b = mount();
    b.testSetIdleSeed(77);
    advanceFrames(b, 60);
    expect(b.testBoardFingerprint()).toBe(fa);
  });

  it("keeps board and score across live and idle handover", () => {
    const view = mount();
    advanceFrames(view, 50);
    const stackFp = view.testStackFingerprint();
    const score = view.testScore();
    const live: Packet = [1_700_000_200, "in", "10.0.0.2", "udp", "53", 96, "eth0", "live", "10.0.0.2:53"];
    view.testIngestLivePackets([live]);
    expect(view.testStackFingerprint()).toBe(stackFp);
    expect(view.testScore()).toBe(score);
    clock += TETRIS_LIVE_QUIET_MS + 1;
    view.onPollEmpty();
    advanceFrames(view, 10);
    expect(view.testScore()).toBeGreaterThanOrEqual(score);
  });

  it("reaches top-out hold from the top-out idle seed within a bounded tick budget", () => {
    const view = mount();
    view.testSetIdleSeed(TETRIS_IDLE_TOPOUT_SEED);
    view.onPollEmpty();
    let hold = 0;
    for (let i = 0; i < 200; i++) {
      clock += FRAME_MS;
      view.hostFrameTick(clock as FrameTs, FRAME_MS / 1000);
      hold = view.testTopoutHoldUntil();
      if (hold > 0) break;
    }
    expect(hold).toBeGreaterThan(clock / 1000);
    expect(hold - clock / 1000).toBeCloseTo(TETRIS_TOPOUT_HOLD_S, 0.5);
  });
});

describe("TetrisIdleScheduler exclusivity", () => {
  it("produces zero idle packets while live-exclusive", () => {
    const sched = new TetrisIdleScheduler(42, 0);
    sched.noteLiveTraffic(100);
    expect(sched.tick(200)).toEqual([]);
    sched.testClearLiveQuiet(1000);
    const pk = sched.tick(2000);
    expect(pk.length).toBeGreaterThan(0);
  });
});

describe("TetrisTrafficBudget", () => {
  it("caps delivery and counts skips like live ingest", () => {
    const b = new TetrisTrafficBudget();
    const batch = Array.from({ length: 12 }, (_, i) => [i, "in", "10.0.0.1", "tcp", "443", 64, "eth0", "", ""] as Packet);
    const taken = b.deliver(batch);
    expect(taken.length).toBe(TETRIS_MAX_PACKETS_PER_FRAME);
    expect(b.hudSkips).toBe(4);
    expect(b.recordCount).toBe(12);
  });
});

describe("tickTetrisIdleFeed", () => {
  it("uses injected clock and budget without reading wall time", () => {
    const nowSpy = vi.spyOn(performance, "now");
    let clock = 0;
    const budget = new TetrisTrafficBudget();
    const scheduler = new TetrisIdleScheduler(42, 0);
    const enqueued: Packet[][] = [];
    for (let i = 0; i < FRAMES; i++) {
      clock += FRAME_MS;
      tickTetrisIdleFeed({
        clockMs: () => clock,
        scheduler,
        budget,
        enqueue: (pk) => enqueued.push(pk),
      }, true);
    }
    expect(nowSpy).not.toHaveBeenCalled();
    expect(budget.recordCount).toBe(DUE_PACKETS);
    nowSpy.mockRestore();
  });
});
