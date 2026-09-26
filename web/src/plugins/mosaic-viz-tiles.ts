import { configStoreId } from "./instances";
import type { PluginView } from "./plugin";

export type MosaicTileVizStep = {
  storeId: string;
  modeId: string;
  tick: (frameT: number) => void;
};

/** Build one viz step per mosaic tile (keyed by configStoreId, never pack-level id alone). */
export function mosaicTileVizSteps(
  tileModeIds: string[],
  specForMode: (modeId: string) => PluginView | null,
  makeTick: (spec: PluginView, storeId: string, modeId: string) => (frameT: number) => void,
): MosaicTileVizStep[] {
  const out: MosaicTileVizStep[] = [];
  for (const modeId of tileModeIds) {
    const spec = specForMode(modeId);
    if (!spec) continue;
    const scoped = { ...spec, configViewId: modeId };
    const storeId = configStoreId(scoped, modeId);
    out.push({ storeId, modeId, tick: makeTick(scoped, storeId, modeId) });
  }
  return out;
}

/** Advance every tile on the wall exactly once for this frame (no shared tick counter). */
export function runMosaicTileVizFrame(steps: MosaicTileVizStep[], frameT: number): void {
  for (const step of steps) step.tick(frameT);
}
