import type { ViewMode } from "../core/modes";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { Settings } from "../ui/settings";
import { bindThisView as bindThisViewHost, type BindThisViewDeps } from "./host-view-bind";

export type MainBindThisViewDeps = {
  settings: Settings | null | undefined;
  hostModeById: (modeId: string) => ViewMode;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  lookForMode: (modeId: string) => PluginLook | null | undefined;
  arcadeControls: (m: ViewMode) => HTMLElement[];
  paintViewAuth: (m: ViewMode, spec: PluginView | null) => void;
};

/** main.ts `bindThisView` — must resolve mosaic slot ids via hostModeById. */
export function runMainBindThisView(deps: MainBindThisViewDeps, modeId: string): void {
  if (!deps.settings) return;
  const hostDeps: BindThisViewDeps = {
    settings: deps.settings,
    hostModeById: deps.hostModeById,
    pluginSpecForMode: deps.pluginSpecForMode,
    lookForMode: deps.lookForMode,
    arcadeControls: deps.arcadeControls,
    paintViewAuth: deps.paintViewAuth,
  };
  bindThisViewHost(hostDeps, modeId);
}
