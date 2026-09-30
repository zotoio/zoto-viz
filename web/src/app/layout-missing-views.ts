/**
 * A saved mosaic layout (profile or localStorage) can name a view that is no longer installed.
 * Resolving it would silently draw the default view (Topology) in that pane, so the pane shows the
 * theme background and one plain notice instead: "<view> isn't installed. Pick another view for
 * this tile." A `picker: hidden` view is installed and still opens by id, so it is not flagged.
 */
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import { clearViewState, showViewState, viewStateOf } from "./view-state";

export type MissingLayoutHost = {
  tileIds: readonly string[];
  /** The catalog (or a host engine) has this view id. */
  isKnownView: (viewId: string) => boolean;
  /** The pane's scene: stage only, so no stand-in graph draws under the notice. */
  paneScene?: (tileId: string) => { setStageOnly(on: boolean): void } | null | undefined;
};

function isMissingNotice(tileId: string): boolean {
  const cur = viewStateOf(tileId);
  return cur?.kind === "couldnt-start" && cur.reason === "missing";
}

/** Flag every layout tile whose view is gone; clears the notice once the view is back. */
export function flagMissingLayoutViews(host: MissingLayoutHost): string[] {
  const missing: string[] = [];
  for (const tileId of host.tileIds) {
    const viewId = mosaicTileViewId(tileId);
    if (host.isKnownView(viewId)) {
      if (isMissingNotice(tileId)) clearViewState(tileId);
      continue;
    }
    missing.push(tileId);
    host.paneScene?.(tileId)?.setStageOnly(true);
    if (isMissingNotice(tileId)) continue;
    const packId = viewId.replace(/^plugin:/, "");
    showViewState(tileId, viewId, packId, { kind: "couldnt-start", reason: "missing", packId });
  }
  return missing;
}
