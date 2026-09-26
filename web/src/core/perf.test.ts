import { afterEach, describe, expect, it } from "vitest";
import { bindFps, markFrame, resetFps, windowFps } from "./fps";
import type { FrameTs } from "./time-ms";
import { DEFAULT_DREAM } from "../graph/scene";
import {
  PERF_FPS, PERF_HOLD_MS, PERF_RECOVER_FPS, PERF_RECOVER_MS,
  notePerfChange, perfOverlay, perfStress, perfWant, resetPerf, tickPerf,
} from "./perf";

function play(from: number, to: number, step: number, enabled = true, ease = 0.45): number {
  let s = 0;
  for (let t = from; t <= to; t += step) {
    markFrame(t as FrameTs);
    s = tickPerf(t, enabled, ease);
  }
  return s;
}

describe("markFrame", () => {
  afterEach(() => {
    resetFps();
    resetPerf();
  });

  it("does not count the same timestamp twice", () => {
    const el = document.createElement("span");
    bindFps(el);
    markFrame(0 as FrameTs);
    markFrame(0 as FrameTs);
    markFrame(500 as FrameTs);
    markFrame(1000 as FrameTs);
    expect(el.textContent).toBe("2");
    markFrame(1100 as FrameTs);
    expect(el.textContent).toBeTruthy();
  });

  it("averages a 30 s window only once the trail is full", () => {
    for (let t = 0; t <= 10_000; t += 200) markFrame(t as FrameTs);
    expect(windowFps(10_000, PERF_HOLD_MS)).toBeNull();
    for (let t = 10_200; t <= PERF_HOLD_MS; t += 200) markFrame(t as FrameTs);
    const fps = windowFps(PERF_HOLD_MS, PERF_HOLD_MS);
    expect(fps).toBeGreaterThan(4);
    expect(fps).toBeLessThan(6);
  });
});

describe("DEFAULT_DREAM", () => {
  it("caps idle labels at 20 and auto-tunes by default", () => {
    expect(DEFAULT_DREAM.labelCount).toBe(20);
    expect(DEFAULT_DREAM.autoTune).toBe(true);
  });
});

describe("tickPerf", () => {
  afterEach(() => {
    resetFps();
    resetPerf();
  });

  it("eases toward lean after 30 s under 10 fps", () => {
    let ts = 0;
    play(0, PERF_HOLD_MS, 200);
    ts = PERF_HOLD_MS;
    expect(windowFps(ts, PERF_HOLD_MS)!).toBeLessThan(PERF_FPS);
    const s = play(ts + 200, ts + 24_000, 200);
    expect(s).toBeGreaterThan(0.5);
    expect(perfWant()).toBe(1);
    const lean = perfOverlay({ ...DEFAULT_DREAM, labelCount: 20 }, s);
    expect(lean.labelCount).toBeLessThan(20);
    expect(lean.partAmt).toBeLessThan(DEFAULT_DREAM.partAmt);
    expect(lean.dprK).toBeGreaterThan(0);
  });

  it("does not restore on a 30 s recovery; waits for a 1-minute recovered average", () => {
    let ts = PERF_HOLD_MS;
    play(0, ts, 200);
    play(ts + 200, ts + 24_000, 200);
    expect(perfWant()).toBe(1);
    const start = ts + 24_000;
    play(start + 16, start + PERF_HOLD_MS, 16);
    ts = start + PERF_HOLD_MS;
    expect(windowFps(ts, PERF_HOLD_MS)!).toBeGreaterThan(PERF_RECOVER_FPS);
    expect(perfWant()).toBe(1);
    expect(perfStress()).toBeGreaterThan(0.5);

    play(ts + 16, ts + PERF_RECOVER_MS, 16, true, 0.2);
    ts += PERF_RECOVER_MS;
    expect(windowFps(ts, PERF_RECOVER_MS)!).toBeGreaterThan(PERF_RECOVER_FPS);
    expect(perfWant()).toBe(0);
    expect(perfStress()).toBeLessThan(1);
    expect(perfStress()).toBeGreaterThan(0);
  });

  it("restarts the 1-minute recovered average after a view change", () => {
    let ts = PERF_HOLD_MS;
    play(0, ts, 200);
    play(ts + 200, ts + 24_000, 200);
    const start = ts + 24_000;
    play(start + 16, start + PERF_HOLD_MS, 16);
    ts = start + PERF_HOLD_MS;
    notePerfChange(ts);
    play(ts + 16, ts + PERF_HOLD_MS, 16);
    ts += PERF_HOLD_MS;
    expect(perfWant()).toBe(1);
    play(ts + 16, ts + PERF_RECOVER_MS, 16, true, 0.2);
    expect(perfWant()).toBe(0);
  });

  it("stays off when auto-tune is disabled", () => {
    play(0, PERF_HOLD_MS, 200, false);
    play(PERF_HOLD_MS + 50, PERF_HOLD_MS + 4_000, 50, false);
    expect(perfStress()).toBe(0);
    expect(perfWant()).toBe(0);
  });

  it("leaves user knobs unchanged when stress is 0", () => {
    const lean = perfOverlay(DEFAULT_DREAM, 0);
    expect(lean.k).toBe(0);
    expect(lean.labelCount).toBe(DEFAULT_DREAM.labelCount);
    expect(lean.partAmt).toBe(DEFAULT_DREAM.partAmt);
    expect(lean.dprK).toBe(0);
  });
});
