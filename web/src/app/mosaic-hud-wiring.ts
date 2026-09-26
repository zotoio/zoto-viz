import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import {
  syncMosaicPluginCaptions,
  type MosaicPluginCaptionHost,
  type MosaicTileHudRow,
  type PluginHudCaptionMap,
} from "../plugins/plugin-hud-sync";

export type MosaicHudWiringDeps = {
  modeById: (tileId: string) => ViewMode;
  pluginSpecForMode: (tileId: string) => PluginView | null;
  optsFor: (mode: ViewMode) => Record<string, string>;
};

export function resolveMosaicTileHudRow(
  tileId: string,
  deps: MosaicHudWiringDeps,
): MosaicTileHudRow | null {
  const m = deps.modeById(tileId);
  if (!m.pluginId) return null;
  const spec = deps.pluginSpecForMode(tileId);
  if (!spec?.settings?.hud?.labelFields?.length) return null;
  const fields = pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config);
  return { mode: m, spec, opts: deps.optsFor(m), fields };
}

/** Mosaic-on guard + per-tile resolver used from main.ts after caption map updates. */
export function syncMosaicPluginHudCaptions(
  mosaic: MosaicPluginCaptionHost | null | undefined,
  captions: PluginHudCaptionMap,
  deps: MosaicHudWiringDeps,
): void {
  if (!mosaic?.on) return;
  syncMosaicPluginCaptions(mosaic, captions, (tileId) => resolveMosaicTileHudRow(tileId, deps));
}
