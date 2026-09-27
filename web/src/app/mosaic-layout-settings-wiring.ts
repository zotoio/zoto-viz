import type { DreamAnim } from "../graph/scene";
import type { Mosaic } from "../graph/mosaic";

export type MosaicLayoutSettingsHost = {
  isOpen: boolean;
  activePaneId: string;
  viewFocus: string;
  prepareMosaicLayoutChange(nextTiles: string[]): void;
  consumePreserveViewBind(): boolean;
};

/** Mirrors main.ts animation callback mosaic layout branch (settings drawer + wall). */
export function applyMosaicLayoutFromAnim(
  mosaic: Mosaic,
  a: DreamAnim,
  settings: MosaicLayoutSettingsHost,
  hooks: {
    layoutKey: string;
    onBeforeSetSize: () => void;
    onAfterSetSize: () => void;
    stopArcadeIfNeeded: () => void;
  },
): boolean {
  const tiles = a.mosaicTiles?.length ? a.mosaicTiles : [];
  const key = `${a.mosaic}:${a.hero}:${tiles.join(",")}:${a.mosaicMaxId ?? ""}`;
  if (key === hooks.layoutKey) return false;
  hooks.stopArcadeIfNeeded();
  settings.prepareMosaicLayoutChange(
    tiles.length ? tiles : mosaic.tileIds,
  );
  hooks.onBeforeSetSize();
  mosaic.setSize(a.mosaic, mosaic.mainMode || mosaic.focusedId, a.hero, {
    tree: a.mosaicTree,
    maximized: a.mosaicMaxId || null,
    tiles,
  });
  hooks.onAfterSetSize();
  return true;
}
