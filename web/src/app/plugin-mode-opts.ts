import type { ViewMode } from "../core/modes";
import { loadPluginConfigCached, type PluginView } from "../plugins/plugin";
import { packConfigValues } from "../plugins/plugin-settings";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";

/** Plugin row opts merged into mode options (used by collectSettings / optsFor). */
export function pluginOptsFromSpec(mode: ViewMode, spec: PluginView): Record<string, string> {
  const fields = pluginViewKnobs(
    { ...spec, options: mode.options, config: mode.config },
    mode.config,
  );
  return packConfigValues(loadPluginConfigCached(spec, fields));
}
