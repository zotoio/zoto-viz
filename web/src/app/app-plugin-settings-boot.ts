import { wireSettingsHost, type SettingsHostDeps } from "./wire-settings-host";

/** Single boot hook main.ts calls to wire plugin settings HUD + mosaic captions. */
export function bootPluginSettingsHost(deps: SettingsHostDeps) {
  return wireSettingsHost(deps);
}
