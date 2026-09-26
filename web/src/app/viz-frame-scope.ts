import type { SourceBind } from "../core/sources";
import { illustratedSourceBind, parseSourceBind } from "../core/sources";
import type { ViewMode } from "../core/modes";
import { normalizeVizDemoPackId } from "../ui/viz-hud";

export type VizFrameScopeDeps = {
  parseSourceBind: (opts: Record<string, string>) => SourceBind;
  illustratedSourceBind: (opts: Record<string, string>) => SourceBind;
  syncAdapterViewOpts: (opts: Readonly<Record<string, string>>) => void;
};

const defaultDeps: VizFrameScopeDeps = {
  parseSourceBind,
  illustratedSourceBind,
  syncAdapterViewOpts: () => {},
};

/** Holds parsed viz source bind + adapter opts between frame ticks; sync only on scope change. */
export class VizFrameScopeCache {
  private bindOpts: Record<string, string> | null = null;
  private sourceBind: SourceBind;

  constructor(private readonly deps: VizFrameScopeDeps = defaultDeps) {
    this.sourceBind = {};
  }

  sync(mode: ViewMode, opts: Record<string, string>): void {
    this.deps.syncAdapterViewOpts(opts);
    if (this.bindOpts === opts) return;
    this.bindOpts = opts;
    const demoPack = normalizeVizDemoPackId(mode.pluginId);
    this.sourceBind = demoPack === "hn-rain" || demoPack === "hn-term"
      ? this.deps.illustratedSourceBind(opts)
      : this.deps.parseSourceBind(opts);
  }

  /** Called on each viz frame tick from main — must not parse options or call optsFor. */
  readBindForFrameTick(): SourceBind {
    return this.sourceBind;
  }
}
