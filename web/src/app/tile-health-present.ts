import type { TileHealthMonitor } from "../plugins/tile-health-monitor";

export type PresentListenerRegistrar = (fn: (ts: number) => void) => void;

/** Production wiring: sample tile health on each present tick. */
export function bindTileHealthPresentTick(
  tileHealth: TileHealthMonitor | null,
  addPresentListener: PresentListenerRegistrar,
): void {
  addPresentListener((ts) => tileHealth?.tick(ts));
}
