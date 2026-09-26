import { leafIds, parseMosaicTiles } from "../graph/mosaic-layout";
import type { DreamAnim } from "../graph/scene";
import { viewSelectOptions } from "./plugin";
import type { PackWallScope } from "./instances";

/** Mosaic tile mode ids for scope notes (production-shaped; deduped like persisted anim). */
function mosaicWallTileModeIds(
  anim: Pick<DreamAnim, "mosaic" | "mosaicTiles" | "mosaicTree">,
): string[] {
  if (anim.mosaicTiles.length) return parseMosaicTiles(anim.mosaicTiles);
  if (anim.mosaicTree) return leafIds(anim.mosaicTree);
  const n = Number(anim.mosaic) || 0;
  return Array.from({ length: n }, (_, i) => viewSelectOptions()[i]?.value ?? "");
}

export function packWallScopeFromAnim(
  anim: Pick<DreamAnim, "mosaic" | "mosaicTiles" | "mosaicTree">,
): PackWallScope {
  const mosaicOn = anim.mosaic !== "off";
  if (!mosaicOn) return { mosaicOn: false, tileModeIds: [] };
  return { mosaicOn: true, tileModeIds: mosaicWallTileModeIds(anim) };
}
