import type { ViewMode } from "../core/modes";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { PluginField } from "../core/modes";
import type { Settings } from "../ui/settings";

export type BindThisViewDeps = {
  settings: Settings;
  hostModeById: (modeId: string) => ViewMode;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  lookForMode: (modeId: string) => PluginLook | null | undefined;
  arcadeControls?: (m: ViewMode) => HTMLElement[];
  paintViewAuth?: (m: ViewMode, spec: PluginView | null) => void;
};

/** main.ts `bindThisView` — rebuilds the view drawer for a mosaic/catalog mode id. */
export function bindThisView(deps: BindThisViewDeps, modeId: string): void {
  const m = deps.hostModeById(modeId);
  const spec = m.pluginId ? deps.pluginSpecForMode(modeId) : null;
  deps.settings.bindView(
    spec ? { ...spec, options: m.options, config: m.config } : null,
    spec ? m.config : undefined,
    deps.lookForMode(m.id) ?? spec?.look,
    deps.arcadeControls?.(m),
    modeId,
  );
  deps.paintViewAuth?.(m, spec);
}
