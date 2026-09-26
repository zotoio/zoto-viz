import { parseMosaicSlotId } from "../graph/mosaic-tile-id";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";

export type MosaicTileHudRow = {
  mode: ViewMode;
  spec: PluginView;
  opts: Record<string, string>;
  fields: import("../core/modes").PluginField[];
};

export type SettingsHostDeps = {
  modeById: (tileId: string) => ViewMode;
  pluginSpecForMode: (viewId: string) => PluginView | null;
  optsFor: (mode: ViewMode) => Record<string, string>;
};

export function resolveMosaicTileHudRow(
  tileId: string,
  deps: SettingsHostDeps,
): MosaicTileHudRow | null {
  const m = deps.modeById(tileId);
  if (!m.pluginId) return null;
  const { viewId } = parseMosaicSlotId(tileId);
  const spec = deps.pluginSpecForMode(viewId);
  if (!spec) return null;
  const fields = pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config);
  return { mode: m, spec, opts: deps.optsFor(m), fields };
}
