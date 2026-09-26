import { leafIds, parseMosaicNode, parseMosaicTiles } from "./mosaic-layout";
import type { DreamAnim } from "./scene";
import { VIZ_MAX_ACTIVE_TILES } from "../plugins/viz-tile-constants";

export const MOSAIC_TILE_LIMIT_MESSAGE =
  "This wall supports at most eight tiles. Keeping your current layout.";

function countRawMosaicTileIds(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let n = 0;
  for (const row of raw) {
    if (typeof row === "string" && row.trim()) n++;
  }
  return n;
}

export function countMosaicTiles(anim: Pick<DreamAnim, "mosaic" | "mosaicTree" | "mosaicTiles">): number {
  if (anim.mosaic === "off") return 0;
  const rawCount = countRawMosaicTileIds(anim.mosaicTiles);
  if (rawCount > 0) return rawCount;
  const fromTiles = parseMosaicTiles(anim.mosaicTiles);
  if (fromTiles.length) return fromTiles.length;
  const tree = parseMosaicNode(anim.mosaicTree);
  if (tree) return leafIds(tree).length;
  const preset = Number(anim.mosaic);
  return Number.isFinite(preset) ? preset : 0;
}

/**
 * Reload / applyAnim entry: refuse layouts with more than {@link VIZ_MAX_ACTIVE_TILES} active tiles.
 */
export function applyDreamAnimWithTileLimit(
  incoming: DreamAnim,
  current: DreamAnim,
): { anim: DreamAnim; refused: boolean; message?: string } {
  const n = countMosaicTiles(incoming);
  if (incoming.mosaic !== "off" && n > VIZ_MAX_ACTIVE_TILES) {
    return { anim: current, refused: true, message: MOSAIC_TILE_LIMIT_MESSAGE };
  }
  return { anim: incoming, refused: false };
}
