import { mosaicTileViewId } from "../graph/mosaic-tile-id";
import { pluginViewId } from "../plugins/plugin";
import {
  syncMosaicPluginCaptions,
  type MosaicPluginCaptionHost,
  type MosaicTileHudRow,
  type PluginHudCaptionMap,
} from "../plugins/plugin-hud-sync";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import { setPluginHudCaptionSink } from "../plugins/plugin-ui";
import type { ViewMode } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { attachPluginFrontendAfterConfigReset } from "./plugin-frontend-attach";

export type SettingsHostDeps = {
  modeById: (tileId: string) => ViewMode;
  pluginSpecForMode: (tileId: string) => PluginView | null;
  optsFor: (mode: ViewMode) => Record<string, string>;
  getMosaicHost: () => MosaicPluginCaptionHost | null;
  captions: PluginHudCaptionMap;
};

export function resolveMosaicTileHudRow(
  tileId: string,
  deps: SettingsHostDeps,
): MosaicTileHudRow | null {
  const m = deps.modeById(tileId);
  if (!m.pluginId) return null;
  const spec = deps.pluginSpecForMode(mosaicTileViewId(tileId));
  if (!spec?.settings?.hud?.labelFields?.length) return null;
  const fields = pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config);
  return { mode: m, spec, opts: deps.optsFor(m), fields };
}

export function syncPluginHudCaptionsFromMap(deps: SettingsHostDeps): void {
  const mosaic = deps.getMosaicHost();
  if (!mosaic) return;
  syncMosaicPluginCaptions(mosaic, deps.captions, (tileId) => resolveMosaicTileHudRow(tileId, deps));
}

export type PluginHudCaptionSink = (spec: PluginView, caption: string | null) => void;

/** Wire caption map → mosaic tiles. Main calls this once at boot. */
export function wireSettingsHost(
  deps: SettingsHostDeps,
  sink: (fn: PluginHudCaptionSink) => void = setPluginHudCaptionSink,
): () => void {
  const onCaption: PluginHudCaptionSink = (spec, caption) => {
    const modeId = pluginViewId(spec.id, spec.instanceId);
    deps.captions.set(modeId, caption);
    syncPluginHudCaptionsFromMap(deps);
  };
  sink(onCaption);
  return () => syncPluginHudCaptionsFromMap(deps);
}

export async function wirePluginFrontendAttach(
  batcher: { reset(): void },
  attach: () => Promise<unknown>,
): Promise<void> {
  return attachPluginFrontendAfterConfigReset(batcher, attach);
}
