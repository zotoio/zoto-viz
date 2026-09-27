import type { BackdropKind } from "../graph/backdrop";
import { mosaicTileViewId, mosaicWallUsesView } from "../graph/mosaic-tile-id";
import type { PluginLook } from "../plugins/plugin";

/** Settings plugin refresh: map focused tile slot → catalog mode id. */
export function modeIdForMosaicPluginChange(focusSlotId: string): string {
  return mosaicTileViewId(focusSlotId);
}

/** After pane picker assigns a view id, focus the matching tile slot (duplicate packs). */
export function mosaicPanePickFocusSlot(tileIds: readonly string[], toViewId: string, fromSlot: string): string {
  return tileIds.find((id) => mosaicTileViewId(id) === toViewId) ?? fromSlot;
}

/** Mosaic mode apply: focus tile slot that already shows this view id. */
export function mosaicFocusSlotForMode(tileIds: readonly string[], modeId: string, fallback: string): string {
  return tileIds.find((id) => mosaicTileViewId(id) === modeId) ?? tileIds[0] ?? fallback;
}

/** Mode switch skips pane swap when the view is already placed on the wall. */
export function mosaicModeAlreadyOnWall(tileIds: readonly string[], modeId: string): boolean {
  return mosaicWallUsesView(tileIds, modeId);
}

/** Agent patch with lockLayout: rewrite focused tile when mode is not on the wall. */
export function agentPatchTilesWhenViewOffWall(
  tileIds: readonly string[],
  focusedId: string | null | undefined,
  viewId: string,
): string[] | null {
  if (mosaicWallUsesView(tileIds, viewId)) return null;
  const tiles = [...tileIds];
  const at = Math.max(0, tiles.indexOf(focusedId ?? ""));
  const from = tiles[at] ?? tiles[0];
  if (!from) return null;
  tiles[at] = viewId;
  return tiles;
}

/** Viz HUD ticks on the solo graph path only (mosaic tiles use per-pane chrome). */
export function shouldTickVizHudForFeed(mosaicOn: boolean): boolean {
  return !mosaicOn;
}

/** Per-tile plugin sky sync uses the pack view id, not the duplicate slot suffix. */
export function mosaicPluginSkyPaneView(
  tileSlotId: string,
  tileSky: BackdropKind | undefined,
  lookForMode: (modeId: string) => PluginLook | undefined,
): { viewId: string; wantPlugin: boolean } {
  const viewId = mosaicTileViewId(tileSlotId);
  const wantPlugin = tileSky === "plugin" || (!tileSky && lookForMode(viewId)?.backdrop === "plugin");
  return { viewId, wantPlugin };
}
