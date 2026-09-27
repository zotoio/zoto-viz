import type { ViewMode } from "../core/modes";
import type { Mosaic } from "../graph/mosaic";
import { configStoreId, configStoreIdForMode } from "../plugins/instances";
import type { PluginView } from "../plugins/plugin";

/** Push one shared pack config to every mosaic tile that uses the same config store. */
export function applySharedMosaicPluginConfig(
  mosaic: Pick<Mosaic, "on" | "tileIds" | "graphScene">,
  spec: PluginView,
  opts: Record<string, string>,
  optsFor: (mode: ViewMode) => Record<string, string>,
  modeById: (tileId: string) => ViewMode,
): void {
  if (!mosaic.on) return;
  const store = configStoreId(spec);
  for (const tileId of mosaic.tileIds) {
    if (configStoreIdForMode(tileId) !== store) continue;
    const pm = modeById(tileId);
    mosaic.graphScene(tileId)?.setMode(pm, optsFor(pm));
  }
}
