import type { SourceBind } from "../core/sources";
import type { ViewMode } from "../core/modes";
import type { VizFrameScopeCache } from "./viz-frame-scope";

export type VizFrameHostPerFrameInput = {
  mode: ViewMode;
  currentOpts: Record<string, string>;
  scope: VizFrameScopeCache;
};

const perFrameTickScratch: { bind: SourceBind; packOpts: Record<string, string> } = {
  bind: {},
  packOpts: {},
};

/**
 * Per-frame viz bind + pack opts read (called from main state tick).
 * Must not call optsFor or parseSourceBind — scope sync owns those.
 */
export function vizFrameHostPerFrameTick(input: VizFrameHostPerFrameInput): {
  bind: SourceBind;
  packOpts: Record<string, string>;
} {
  perFrameTickScratch.bind = input.scope.readBindForFrameTick();
  perFrameTickScratch.packOpts = input.currentOpts;
  return perFrameTickScratch;
}
