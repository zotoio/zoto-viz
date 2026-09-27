import { TileHealthMonitor, type TileHealthDeps } from "../plugins/tile-health-monitor";

/** Same constructor path `main.ts` uses (#31 production wiring). */
export function createProductionTileHealthMonitor(deps: TileHealthDeps): TileHealthMonitor {
  return new TileHealthMonitor(deps);
}
