import { modeById, type ViewMode } from "../core/modes";
import { mosaicPaneMode } from "../graph/mosaic";
import { parseMosaicSlotId } from "../graph/mosaic-tile-id";

/** Resolve a mosaic tile slot id or catalog mode id to the correct ViewMode. */
function withSlotId(modeId: string, mode: ViewMode): ViewMode {
  return mode.id === modeId ? mode : { ...mode, id: modeId };
}

export function hostModeById(modeId: string): ViewMode {
  const { viewId, slot } = parseMosaicSlotId(modeId);
  if (slot != null && modeId.startsWith("plugin:")) {
    return withSlotId(modeId, mosaicPaneMode(modeId));
  }
  const catalog = modeById(viewId);
  if (modeId.startsWith("plugin:") && catalog.id !== viewId && !catalog.pluginId) {
    return withSlotId(modeId, mosaicPaneMode(modeId));
  }
  const mode = catalog.id === viewId ? catalog : mosaicPaneMode(modeId);
  return withSlotId(modeId, mode);
}
