import type { ViewMode } from "../core/modes";
import { defaultOpts } from "../core/modes";
import type { PluginView } from "../plugins/plugin";
import { loadPluginConfig } from "../plugins/plugin";
import { pluginViewKnobs } from "../plugins/plugin-visualisation";
import { parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { illustratedSourceBind, parseSourceBind } from "../core/sources";

/** Same shape as `optsFor` in main.ts without any cross-frame cache (main @6520b01). */
export function buildPresentOptsFor(m: ViewMode, spec: PluginView | null): Record<string, string> {
  const o = defaultOpts(m);
  if (m.pluginId) {
    if (spec) {
      Object.assign(
        o,
        loadPluginConfig(spec, pluginViewKnobs({ ...spec, options: m.options, config: m.config }, m.config)),
      );
    }
  } else {
    for (const opt of m.options ?? []) {
      const saved = localStorage.getItem(`zoto-viz.mode.${m.id}.${opt.key}`);
      if (saved !== null && opt.values.some(([v]) => v === saved)) o[opt.key] = saved;
    }
  }
  return o;
}

/**
 * Steady present-loop `optsFor(mode)` sites (bind + pack handler + optional hn-rain look).
 * Matches main.ts present path for a viz.read pack.
 */
export function invokePresentLoopOptsForSites(
  optsFor: (m: ViewMode) => Record<string, string>,
  mode: ViewMode,
  packId: string | null,
): void {
  if (packId === "hn-rain" || packId === "hn-term") {
    illustratedSourceBind(optsFor(mode));
  } else {
    parseSourceBind(optsFor(mode));
  }
  if (packId) {
    optsFor(mode);
  }
  if (packId === "hn-rain") {
    parseHnRainLook(optsFor(mode));
  }
}

/** Pinned at main `6520b01` for plugin steady present (2× optsFor; 5 knob keys × 2 store reads each). */
export const MAIN_PRESENT_OPTS_LOCALSTORAGE_GETS_PER_FRAME_6520B01 = 22;
