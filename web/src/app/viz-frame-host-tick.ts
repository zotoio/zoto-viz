import type { SourceBind } from "../core/sources";
import type { ViewMode } from "../core/modes";
import type { VizFrameScopeCache } from "./viz-frame-scope";

export type VizFrameHostPerFrameInput = {
  mode: ViewMode;
  currentOpts: Record<string, string>;
  scope: VizFrameScopeCache;
  optsFor: (m: ViewMode) => Record<string, string>;
};

/**
 * Per-frame viz bind + pack opts read (called from main state tick).
 * Must not call optsFor or parseSourceBind — scope sync owns those.
 */
export function vizFrameHostPerFrameTick(input: VizFrameHostPerFrameInput): {
  bind: SourceBind;
  packOpts: Record<string, string>;
} {
  return {
    bind: input.scope.readBindForFrameTick(),
    packOpts: input.currentOpts,
  };
}

/** Scope sync path: optsFor once, then parse bind into scope (applyMode / onPluginFields). */
export function vizFrameHostScopeSync(
  mode: ViewMode,
  scope: VizFrameScopeCache,
  optsFor: (m: ViewMode) => Record<string, string>,
): Record<string, string> {
  const opts = optsFor(mode);
  scope.sync(mode, opts);
  return opts;
}
