import { setVizBuildCostTicksInjector } from "./viz-clock";

let devTileCostTicks: number | null = null;
let wallBuildReads = 0;

/** Dev-only `?vizTileCostTicks=`; read once per wall build, never per frame. */
export function readDevTileCostOnWallBuild(search: string): void {
  wallBuildReads++;
  if (!import.meta.env.DEV) {
    devTileCostTicks = null;
    setVizBuildCostTicksInjector(undefined);
    return;
  }
  const raw = new URLSearchParams(search).get("vizTileCostTicks");
  if (!raw) {
    devTileCostTicks = null;
    setVizBuildCostTicksInjector(undefined);
    return;
  }
  const ticks = Number(raw);
  devTileCostTicks = Number.isFinite(ticks) ? ticks : null;
  if (devTileCostTicks === null) {
    setVizBuildCostTicksInjector(undefined);
    return;
  }
  const fixed = devTileCostTicks;
  setVizBuildCostTicksInjector(() => fixed);
}

export function devTileCostTicksActive(): number | null {
  return devTileCostTicks;
}

export function devTileCostWallBuildReads(): number {
  return wallBuildReads;
}

export function resetDevTileCostForTests(): void {
  devTileCostTicks = null;
  wallBuildReads = 0;
  setVizBuildCostTicksInjector(undefined);
}
