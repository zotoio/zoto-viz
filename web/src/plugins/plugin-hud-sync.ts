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

/** Single overlay HUD: shows the focused view's settings caption (mosaic uses focused tile id). */
export function syncPluginHudForMode(
  m: { id: string; pluginId?: string | null; label: string },
  spec: PluginView | null,
  captions: PluginHudCaptionMap,
  vizHud: VizHudLike,
): void {
  const cap = spec?.settings?.hud?.labelFields?.length
    ? (captions.get(m.id) ?? null)
    : null;
  const demo = normalizeVizDemoPackId(m.pluginId ?? spec?.id);
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
