import type { MosaicLayoutPatch } from "../graph/mosaic";
import type { Settings } from "../ui/settings";

/** Same handler Mosaic `onLayout` uses in main.ts (wall resize / tile assign / close). */
export function applyWallLayoutPatch(settings: Settings, patch: MosaicLayoutPatch): void {
  settings.applyMosaicLayout(patch);
}
