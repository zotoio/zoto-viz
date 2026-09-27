import type { PluginSandbox } from "./host";
import type { VizPluginContract } from "./viz-host";
import { notePackPresentDelivery } from "../core/pack-host-perf";

/**
 * Cached when the active view mode changes — no per-frame `pluginSpecs.find`.
 * One tick per sandbox per frame. v3 `tileId` / `aspect` reserved pending Andrew's sandbox model.
 */
export interface PresentDriveBinding {
  sandbox: PluginSandbox;
  contract: VizPluginContract | undefined;
  /** Pack id on the wire (`tileId`); not instance or mosaic slot id. */
  tileId: string;
  pluginClock: () => number;
  stageAspect: () => number;
}

/** `VizPresentTick.tileId`: catalog pack id only. */
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

let presentTickDeliveries = 0;
let presentTickByTile: Record<string, number> = {};

export function resetPresentTickStatsForTests(): void {
  presentTickDeliveries = 0;
  presentTickByTile = {};
}

export function presentTickStats(): { total: number; byTile: Record<string, number> } {
  return { total: presentTickDeliveries, byTile: { ...presentTickByTile } };
}

export function deliverPluginPresentTick(binding: PresentDriveBinding | null, frameMs: number): void {
  if (!binding?.contract?.presentTick) return;
  presentTickDeliveries += 1;
  const tile = binding.tileId || "_";
  presentTickByTile[tile] = (presentTickByTile[tile] ?? 0) + 1;
  binding.sandbox.deliverPresentTick(
    frameMs,
    binding.tileId,
    binding.pluginClock(),
    binding.stageAspect(),
  );
  notePackPresentDelivery(binding.tileId);
}
