import type { DreamAnim } from "../graph/scene";
import type { Mosaic } from "../graph/mosaic";
import type { NetScene } from "../graph/scene";
export function mosaicAnimLayoutKey(a: DreamAnim): string {
  const tiles = a.mosaicTiles?.length ? a.mosaicTiles : [];
  return `${a.mosaic}:${a.hero}:${tiles.join(",")}:${a.mosaicMaxId ?? ""}`;
}

export type SettingsMosaicAnimSyncDeps = {
  mosaic: Mosaic;
  scene: NetScene;
  modeId: string;
  pinViewLook: boolean;
  soloAnim: (a: DreamAnim) => void;
  applyMode: (modeId: string, opts: { keepLayout: boolean }) => void;
  onArcadeStop?: () => void;
};

/** main.ts `settings.addAnimation` mosaic branch (layoutKey → setSize). */
export function syncSettingsAnimToMosaic(deps: SettingsMosaicAnimSyncDeps, a: DreamAnim): void {
  const pin = deps.pinViewLook;
  if (deps.mosaic.on) {
    deps.mosaic.applyLooks(a, pin);
    deps.mosaic.setTheme(deps.scene.currentTheme);
  } else {
    deps.soloAnim(a);
  }
  const key = mosaicAnimLayoutKey(a);
  if (key !== deps.mosaic.layoutKey) {
    deps.onArcadeStop?.();
    deps.mosaic.setSize(a.mosaic, deps.modeId, a.hero, {
      tree: a.mosaicTree,
      maximized: a.mosaicMaxId || null,
      tiles: a.mosaicTiles,
    });
    deps.applyMode(deps.modeId, { keepLayout: true });
  }
}
