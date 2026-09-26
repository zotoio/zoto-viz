import type { PluginField } from "../core/modes";
import type { PluginView } from "./plugin";
import { buildPluginHudCaption } from "./plugin-settings";
import { normalizeVizDemoPackId, type VizDemoPackId } from "../ui/viz-hud";

export type PluginHudCaptionMap = Map<string, string | null>;

export type VizHudLike = {
  setActive: (packId: VizDemoPackId | null, packName: string) => void;
  showSettingsCaptionHud: (packName: string) => void;
  hideSettingsCaptionHud: () => void;
  setPackCaption: (suffix: string | null) => void;
};

export type MosaicPluginCaptionHost = {
  on: boolean;
  tileIds: readonly string[];
  setPaneSettingsCaption: (tileId: string, text: string | null) => void;
};

export type MosaicTileHudRow = {
  mode: { id: string; pluginId?: string | null; label: string };
  spec: PluginView;
  opts: Record<string, string>;
  fields: PluginField[];
};

/** Paint each mosaic tile's settings caption inside that tile's frame. */
export function syncMosaicPluginCaptions(
  host: MosaicPluginCaptionHost,
  captions: PluginHudCaptionMap,
  resolveTile: (tileId: string) => MosaicTileHudRow | null,
): void {
  if (!host.on) return;
  for (const tileId of host.tileIds) {
    const row = resolveTile(tileId);
    if (!row?.spec.settings?.hud?.labelFields?.length) {
      host.setPaneSettingsCaption(tileId, null);
      continue;
    }
    const suffix = captions.get(row.mode.id) ?? buildPluginHudCaption(row.spec, row.fields, row.opts);
    host.setPaneSettingsCaption(
      tileId,
      suffix ? `${row.spec.name} · ${suffix}` : null,
    );
  }
}

/** Global VizHud: demoscene packs only when mosaic is on (settings captions are per-tile). */
export function syncPluginHudForMode(
  m: { id: string; pluginId?: string | null; label: string },
  spec: PluginView | null,
  captions: PluginHudCaptionMap,
  vizHud: VizHudLike,
  mosaicOn = false,
): void {
  const cap = spec?.settings?.hud?.labelFields?.length
    ? (captions.get(m.id) ?? null)
    : null;
  const demo = normalizeVizDemoPackId(m.pluginId ?? spec?.id);
  if (mosaicOn) {
    vizHud.hideSettingsCaptionHud();
    if (demo) {
      vizHud.setActive(demo, spec?.name ?? m.label);
      vizHud.setPackCaption(cap);
    } else {
      vizHud.setActive(null, "");
      vizHud.setPackCaption(null);
    }
    return;
  }
  if (demo) {
    vizHud.setActive(demo, spec?.name ?? m.label);
    vizHud.setPackCaption(cap);
  } else if (spec?.settings?.hud?.labelFields?.length) {
    vizHud.showSettingsCaptionHud(spec.name);
    vizHud.setPackCaption(cap);
  } else {
    vizHud.hideSettingsCaptionHud();
    vizHud.setActive(null, "");
    vizHud.setPackCaption(null);
  }
}

export function hudCaptionFromOpts(
  spec: PluginView,
  fields: PluginField[],
  opts: Record<string, string>,
): string | null {
  if (!spec.settings?.hud?.labelFields?.length) return null;
  return buildPluginHudCaption(spec, fields, opts);
}
