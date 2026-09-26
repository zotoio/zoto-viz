import { defaultOpts, type ViewMode } from "../core/modes";
import { loadPluginConfig, type PluginView } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";

/** Resolve view option strings for a mode (same logic as the monitor host). */
export function optsForMode(
  m: ViewMode,
  pluginSpecForMode: (modeId: string) => PluginView | null,
): Record<string, string> {
  const o = defaultOpts(m);
  if (m.pluginId) {
    const spec = pluginSpecForMode(m.id);
    if (spec) Object.assign(o, loadPluginConfig(spec, pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config)));
  } else {
    for (const opt of m.options ?? []) {
      const saved = localStorage.getItem(`zoto-viz.mode.${m.id}.${opt.key}`);
      if (saved !== null && opt.values.some(([v]) => v === saved)) o[opt.key] = saved;
    }
  }
  return o;
}
