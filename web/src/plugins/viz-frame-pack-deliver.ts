import type { VizDataFrame } from "./viz-host";

export type VizPackTileFrameHandler = (frame: VizDataFrame) => void;

export type VizPackTileDelivery = {
  tileId: string;
  onFrame: VizPackTileFrameHandler;
};

/** Invoke each tile's frame handler on the same host frame; isolate throws so one pack cannot stop the loop. */
export function deliverVizFrameToPackTiles(
  frame: VizDataFrame,
  tiles: readonly VizPackTileDelivery[],
): void {
  for (const tile of tiles) {
    try {
      tile.onFrame(frame);
    } catch {
      /* strict-mode mutation of frozen contract slices (e.g. links.push) must not abort other tiles */
    }
  }
}
