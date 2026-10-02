import { defaultOpts, type ViewMode } from "../core/modes";
import { emptyScopeStore, resolve } from "../core/settings-scope";
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
      if (saved === null || !opt.values.some(([v]) => v === saved)) continue;
      const store = emptyScopeStore();
      store.view[m.id] = { [opt.key]: saved };
      store.builtin[opt.key] = o[opt.key] ?? "";
      const got = resolve(store, opt.key, {
        packId: "",
        viewId: m.id,
        wallId: "default",
        tileId: m.id,
      });
      if (typeof got === "string") o[opt.key] = got;
    }
  }
  return o;
}
