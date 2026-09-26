import { setVizBuildCostTicksInjector, setVizBuildCostTicksForTileInjector } from "./viz-clock";

let devTileCostByTile = new Map<string, number>();

/** Dev-only `?vizTileCostTicks=` global or `?vizTileCostTicks=<tileIndex>:<ticks>` per scoped tile. */
export function readDevTileCostOnWallBuild(search: string, scopedTileIds: readonly string[]): void {
  devTileCostByTile = new Map();
  setVizBuildCostTicksForTileInjector(undefined);
  setVizBuildCostTicksInjector(undefined);
  if (!import.meta.env.DEV) return;

  const raw = new URLSearchParams(search).get("vizTileCostTicks");
  if (!raw) return;

  const colon = raw.indexOf(":");
  if (colon >= 0) {
    const idx = Number(raw.slice(0, colon));
    const ticks = Number(raw.slice(colon + 1));
    if (!Number.isFinite(idx) || !Number.isFinite(ticks) || idx < 0 || idx >= scopedTileIds.length) return;
    devTileCostByTile.set(scopedTileIds[idx]!, ticks);
    setVizBuildCostTicksForTileInjector((tileId) => devTileCostByTile.get(tileId));
    return;
  }

  const ticks = Number(raw);
  if (!Number.isFinite(ticks)) return;
  setVizBuildCostTicksInjector(() => ticks);
}

export function devTileCostTicksForTile(tileId: string): number | undefined {
  return devTileCostByTile.get(tileId);
}
