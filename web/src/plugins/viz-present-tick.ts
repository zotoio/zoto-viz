import type { PluginSandbox } from "./host";
import type { VizPluginContract } from "./viz-host";

/**
 * Cached when the active view mode changes — no per-frame `pluginSpecs.find`.
 * `tileId` is informational (mosaic focus / stage mode); one tick per sandbox per frame.
 */
export interface PresentDriveBinding {
  sandbox: PluginSandbox;
  contract: VizPluginContract | undefined;
  tileId: string;
  pluginClock: () => number;
}

export function deliverPluginPresentTick(binding: PresentDriveBinding | null, frameMs: number): void {
  if (!binding?.contract?.presentTick) return;
  binding.sandbox.deliverPresentTick(frameMs, binding.tileId, binding.pluginClock());
}
