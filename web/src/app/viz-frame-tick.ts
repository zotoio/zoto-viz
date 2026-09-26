import type { Mosaic } from "../graph/mosaic";
import { deliverCoalescedMosaicPacks } from "../graph/mosaic-pack-coalesce";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { runPackFrameHandler, type VizPackHandlers } from "../plugins/viz-pack-host";
import type { VizDataFrame, VizFrameBudgetStats } from "../plugins/viz-host";
import type { VizDemoPackId } from "../ui/viz-hud";

export type VizFrameTickSandbox = {
  frame(frame: VizDataFrame): void;
  handlers: Partial<VizPackHandlers>;
};

/** Delivers one viz frame to the TS sandbox and any demo pack handlers (mosaic coalesce or single-tile). */
export function deliverVizPluginFrame(input: {
  frame: VizDataFrame;
  sandbox: VizFrameTickSandbox;
  mosaic: Pick<Mosaic, "on" | "tileIds" | "graphScene"> | null | undefined;
  mosaicDemoPacks: boolean;
  packId: VizDemoPackId | null;
  activeMode: ViewMode;
  modeById: (viewId: string) => ViewMode;
  mosaicTileViewId: (slot: string) => string;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  optsFor: (m: ViewMode) => Record<string, string>;
  budgetStats: VizFrameBudgetStats;
}): void {
  input.sandbox.frame(input.frame);
  if (input.mosaic?.on && input.mosaicDemoPacks) {
    deliverCoalescedMosaicPacks({
      mosaic: input.mosaic,
      frame: input.frame,
      modeById: (id) => input.modeById(input.mosaicTileViewId(id)),
      pluginSpecForMode: input.pluginSpecForMode,
      optsFor: input.optsFor,
      budget: { stats: input.budgetStats },
    });
  } else if (input.packId) {
    runPackFrameHandler(input.packId, input.frame, {
      writeBuffer: (slot, data) => input.sandbox.handlers.writeBuffer?.(slot, data),
      writeUniform: (name, value) => input.sandbox.handlers.writeUniform?.(name, value),
      writeParticles: (data, stride) => input.sandbox.handlers.writeParticles?.(data, stride),
    }, input.optsFor(input.activeMode));
  }
}
