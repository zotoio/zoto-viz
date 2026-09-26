import type { PluginSandbox } from "./host";
import type { VizPluginContract } from "./viz-host";

/**
 * Cached when the active view mode changes — no per-frame `pluginSpecs.find`.
 * One tick per sandbox per frame. `tileId` meaning is undecided (sandbox-per-tile TBD).
 */
export interface PresentDriveBinding {
  sandbox: PluginSandbox;
  contract: VizPluginContract | undefined;
  /** Stable pack id until the sandbox-per-tile decision; not mosaic focus. */
  tileId: string;
  pluginClock: () => number;
  stageAspect: () => number;
}

/** Neutral present-tick id: the loaded pack id (not mosaic pane / mode slug). */
export function presentTickTileId(packId: string | undefined): string {
  return packId?.trim() || "";
}

export function presentDriveBindingForPlugin(
  sandbox: PluginSandbox,
  spec: { id: string; viz?: VizPluginContract } | null,
  pluginClock: () => number,
  stageAspect: () => number,
): PresentDriveBinding | null {
  if (!spec) return null;
  return {
    sandbox,
    contract: spec.viz,
    tileId: presentTickTileId(spec.id),
    pluginClock,
    stageAspect,
  };
}

export function deliverPluginPresentTick(binding: PresentDriveBinding | null, frameMs: number): void {
  if (!binding?.contract?.presentTick) return;
  binding.sandbox.deliverPresentTick(
    frameMs,
    binding.tileId,
    binding.pluginClock(),
    binding.stageAspect(),
  );
}
