import type { StateMsg } from "../core/types";
import { vizClockMs } from "../core/viz-clock";
import { type MonoMs, monoMs } from "../core/viz-time";
import type { VizDataFrame } from "../plugins/viz-host";
import { VizFrameBudget, buildVizFrame, buildVizFrameForPlugin } from "../plugins/viz-host";
import type { VizIdleConfig } from "../plugins/viz-host";
import type { SourceBind } from "../core/sources";

export interface MainVizDeliverInput {
  budget: VizFrameBudget;
  /** Previous delivered frame monotonic clock, not {@link VizDataFrame.t}. */
  prevClockMs: MonoMs;
  state: StateMsg;
  audio: number;
  onFrame: (frame: VizDataFrame) => void;
  buildFrame: (state: StateMsg, prevClockMs: MonoMs, audio: number) => VizDataFrame;
}

export interface MainVizDeliverResult {
  frame: VizDataFrame | null;
  nextClockMs: MonoMs;
}

/** Mirrors `main.ts` viz budget deliver: monotonic clock for `buildVizFrame` dt. */
export function mainVizDeliver(input: MainVizDeliverInput): MainVizDeliverResult {
  const { budget, prevClockMs, state, audio, onFrame, buildFrame } = input;
  const frame = budget.deliver(state, prevClockMs, audio, onFrame, buildFrame);
  const nextClockMs = frame ? monoMs(vizClockMs()) : prevClockMs;
  return { frame, nextClockMs };
}

export function mainVizBuildFrame(
  state: StateMsg,
  prevClockMs: MonoMs,
  audio: number,
  idle?: VizIdleConfig,
  bind?: SourceBind | Record<string, string>,
): VizDataFrame {
  return idle
    ? buildVizFrameForPlugin(state, prevClockMs, audio, idle, bind)
    : buildVizFrame(state, prevClockMs, audio, bind);
}
