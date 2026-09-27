import type { Mosaic } from "../graph/mosaic";
import type { ViewMode } from "../core/modes";
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import type { PluginView } from "../plugins/plugin";

export type MosaicPanePickDeps = {
  getMosaic: () => Mosaic | null;
  hostModeById: (modeId: string) => ViewMode;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  ensureReviewed?: (spec: PluginView | null) => Promise<boolean>;
  afterPick?: (slot: string, toViewId: string, pm: ViewMode) => void;
};

/** main.ts `settings.onMosaicPanePick` body (live wall + drawer slot picker). */
export function createMosaicPanePickHandler(deps: MosaicPanePickDeps): (from: string, to: string) => boolean {
  return (from, to) => {
    const mosaic = deps.getMosaic();
    if (!mosaic?.on) return false;
    if (!mosaic.setPaneView(from, to)) return false;
    const slot = mosaic.tileIds.find((id) => mosaicTileViewId(id) === to) ?? from;
    const pm = deps.hostModeById(to);
    mosaic.focus(slot);
    void (async () => {
      const spec = pm.pluginId ? deps.pluginSpecForMode(pm.id) : null;
      if (deps.ensureReviewed && !(await deps.ensureReviewed(spec))) return;
      deps.afterPick?.(slot, to, pm);
    })();
    return true;
  };
}
