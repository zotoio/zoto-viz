import type { ViewMode } from "../core/modes";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "../plugins/plugin";
import { applySharedMosaicPluginConfig } from "./shared-mosaic-plugin-config";

export type PluginFieldsFromSettingsDeps = {
  settingsTargetModeId: () => string;
  hostModeById: (id: string) => ViewMode;
  optsFor: (m: ViewMode) => Record<string, string>;
  mosaic: Pick<Mosaic, "on" | "graphScene" | "tileIds"> | null;
  scene: { setMode: (m: ViewMode, opts: Record<string, string>) => void };
  pluginSpecForMode: (modeId: string) => PluginView | null;
  setCurrentOpts: (opts: Record<string, string>) => void;
  setSkyPrompt: (pluginId: string, prompt: string) => void;
  setNestLook: (opts: Record<string, string>) => void;
  onCarouselBind?: (opts: Record<string, string>) => void;
  isCarouselMode?: (m: ViewMode) => boolean;
  viewPromptKey: string;
  afterSync?: (m: ViewMode, opts: Record<string, string>) => void;
};

/** main.ts `onPluginFields` body — shared mosaic sync runs once per edit. */
export function syncPluginFieldsFromSettingsEdit(deps: PluginFieldsFromSettingsDeps): void {
  const modeId = deps.settingsTargetModeId();
  const m = deps.hostModeById(modeId);
  const opts = deps.optsFor(m);
  deps.setCurrentOpts(opts);
  deps.setSkyPrompt(m.pluginId ?? m.id, opts[deps.viewPromptKey] ?? "");
  deps.setNestLook(opts);
  if (deps.isCarouselMode?.(m)) deps.onCarouselBind?.(opts);
  const spec = m.pluginId ? deps.pluginSpecForMode(modeId) : null;
  const mosaic = deps.mosaic;
  if (mosaic?.on && !(m.pluginId && m.standalone)) {
    mosaic.graphScene(m.id)?.setMode(m, opts);
  } else {
    deps.scene.setMode(m, opts);
  }
  deps.afterSync?.(m, opts);
}
