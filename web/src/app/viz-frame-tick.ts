import type { ViewMode } from "../core/modes";
import { runPackFrameHandler, type VizPackHandlers } from "../plugins/viz-pack-host";
import type { VizDataFrame, VizFrameBudgetStats } from "../plugins/viz-host";
import type { VizDemoPackId } from "../ui/viz-hud";

export type VizFrameTickSandbox = {
  frame(frame: VizDataFrame): void;
  handlers: Partial<VizPackHandlers>;
};

/** Delivers one viz frame to the TS sandbox and any demo pack handler (solo tile). */
export function deliverVizPluginFrame(input: {
  frame: VizDataFrame;
  sandbox: VizFrameTickSandbox;
  packId: VizDemoPackId | null;
  activeMode: ViewMode;
  optsFor: (m: ViewMode) => Record<string, string>;
  budgetStats: VizFrameBudgetStats;
}): void {
  input.sandbox.frame(input.frame);
  if (input.packId) {
    runPackFrameHandler(input.packId, input.frame, {
      writeBuffer: (slot, data) => input.sandbox.handlers.writeBuffer?.(slot, data),
      writeUniform: (name, value) => input.sandbox.handlers.writeUniform?.(name, value),
      writeParticles: (data, stride) => input.sandbox.handlers.writeParticles?.(data, stride),
    }, input.optsFor(input.activeMode));
  }
}
