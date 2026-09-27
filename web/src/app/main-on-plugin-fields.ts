import type { ViewMode } from "../core/modes";
import type { NetScene } from "../graph/scene";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "../plugins/plugin";
import type { Settings } from "../ui/settings";
import {
  syncPluginFieldsFromSettingsEdit,
} from "./plugin-fields-from-settings";

/** Dependencies for main.ts `onPluginFields` (wires settings edits into scenes). */
export type MainOnPluginFieldsDeps = {
  settings: Settings;
  modeSelValue: () => string;
  hostModeById: (id: string) => ViewMode;
  optsFor: (m: ViewMode) => Record<string, string>;
  mosaic: Pick<Mosaic, "on" | "graphScene"> | null | undefined;
  scene: Pick<NetScene, "setMode">;
  pluginSpecForMode: (modeId: string) => PluginView | null;
  setCurrentOpts: (o: Record<string, string>) => void;
  setSkyPrompt: (id: string, prompt: string) => void;
  setNestLook: (o: Record<string, string>) => void;
  isCarouselMode: (m: ViewMode) => boolean;
  onCarouselBind: (o: Record<string, string>) => void;
  viewPromptKey: string;
  afterSync: (m: ViewMode, o: Record<string, string>) => void;
};

/** main.ts `onPluginFields` body. */
export function runMainOnPluginFields(deps: MainOnPluginFieldsDeps): void {
  syncPluginFieldsFromSettingsEdit({
    settings: deps.settings,
    fallbackModeId: deps.modeSelValue,
    hostModeById: deps.hostModeById,
    optsFor: deps.optsFor,
    mosaic: deps.mosaic,
    scene: deps.scene,
    pluginSpecForMode: deps.pluginSpecForMode,
    setCurrentOpts: deps.setCurrentOpts,
    setSkyPrompt: deps.setSkyPrompt,
    setNestLook: deps.setNestLook,
    isCarouselMode: deps.isCarouselMode,
    onCarouselBind: deps.onCarouselBind,
    viewPromptKey: deps.viewPromptKey,
    afterSync: deps.afterSync,
  });
}
