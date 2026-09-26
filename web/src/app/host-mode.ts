import { modeById, type ViewMode } from "../core/modes";
import { mosaicPaneMode } from "../graph/mosaic";

/** Resolve a mosaic tile slot id or catalog mode id to the correct ViewMode. */
export function hostModeById(modeId: string): ViewMode {
  if (modeId.includes("!") && modeId.startsWith("plugin:")) return mosaicPaneMode(modeId);
  const catalog = modeById(modeId);
  if (modeId.startsWith("plugin:") && catalog.id !== modeId && !catalog.pluginId) {
    return mosaicPaneMode(modeId);
  }
  return catalog.id === modeId ? catalog : mosaicPaneMode(modeId);
}
