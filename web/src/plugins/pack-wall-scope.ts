import { leafIds, parseMosaicTiles } from "../graph/mosaic-layout";
import type { DreamAnim } from "../graph/scene";
import { viewSelectOptions } from "./plugin";
import type { PackWallScope } from "./instances";

/** Mosaic tile mode ids for scope notes (production-shaped; deduped like persisted anim). */
export function packWallScopeFromAnim(
  anim: Pick<DreamAnim, "mosaic" | "mosaicTiles" | "mosaicTree">,
): PackWallScope {
  const mosaicOn = anim.mosaic !== "off";
  if (!mosaicOn) return { mosaicOn: false, tileModeIds: [] };
  const n = anim.mosaicTiles.length
    || (anim.mosaicTree ? leafIds(anim.mosaicTree).length : Number(anim.mosaic) || 0);
  const tileModeIds = anim.mosaicTiles.length
    ? parseMosaicTiles(anim.mosaicTiles)
    : anim.mosaicTree
      ? leafIds(anim.mosaicTree)
      : Array.from({ length: n }, (_, i) => viewSelectOptions()[i]?.value ?? "");
  return { mosaicOn: true, tileModeIds };
}
