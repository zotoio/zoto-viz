import type { RenderScaleConfig } from "./render-scale-governor";
import { RenderScaleGovernor } from "./render-scale-governor";
import { arbitrateRenderScaleSteps, type RenderScaleArbiterEntry } from "./render-scale-arbiter";
import type { VizFrameBudgetStats } from "./viz-host";
import { VizFrameBudget, VIZ_FRAME_BUDGET_MS } from "./viz-host";

/** Per-view adaptive render scale (one governor + timing window per pane). */
export class RenderScaleViewState {
  readonly frameBudget = new VizFrameBudget();
  private governor: RenderScaleGovernor | null = null;
  private config: RenderScaleConfig | null = null;
  private lastAnimTs = -1;

  get renderScale(): number {
    return this.governor?.scale ?? 1;
  }

  get hasGovernor(): boolean {
    return this.config != null;
  }

  configure(config: RenderScaleConfig | null | undefined): void {
    this.config = config ?? null;
    if (!this.config) {
      this.governor = null;
      this.frameBudget.reset();
      this.lastAnimTs = -1;
      return;
    }
    this.governor = new RenderScaleGovernor(this.config);
  }

  setGpuTimerAvailable(ok: boolean): void {
    this.frameBudget.setGpuTimerAvailable(ok);
  }

  noteGpuMs(ms: number): void {
    this.frameBudget.noteGpuMs(ms);
  }

  /** Call once per pane animation frame with the shared rAF timestamp. */
  onPaneFrame(ts: number): void {
    if (this.lastAnimTs >= 0) {
      const dt = ts - this.lastAnimTs;
      if (dt > 0) this.frameBudget.record(dt);
    }
    this.lastAnimTs = ts;
  }

  p95ForGovernor(): number {
    return this.frameBudget.p95ForGovernor();
  }

  /** Exposed for the page arbiter; null when `render.scale` is absent. */
  governorForArbiter(): RenderScaleGovernor | null {
    return this.governor;
  }

  /** Host governor off — reset hysteresis and keep scale at 1.0. */
  holdUnitScale(): void {
    this.governor?.reset();
  }

  stats(): VizFrameBudgetStats {
    return this.frameBudget.stats;
  }
}

export interface RenderScalePane {
  /** Pane is mounted and animating on the shared render host. */
  readonly renderScaleActive: boolean;
  readonly renderScaleState: RenderScaleViewState;
  applyRenderScale(scale: number): void;
}

/** Count active hosted panes that draw on the shared wall. */
export function visibleRenderingPaneCount(panes: readonly RenderScalePane[]): number {
  let n = 0;
  for (const p of panes) {
    if (p.renderScaleActive) n++;
  }
  return Math.max(1, n);
}

export function sharedRenderBudgetMs(
  panes: readonly RenderScalePane[],
  pageBudgetMs = VIZ_FRAME_BUDGET_MS,
): number {
  return pageBudgetMs / visibleRenderingPaneCount(panes);
}

/** Advance every pane governor that declared `render.scale` (page arbiter gated). */
export function tickRenderScalePanes(
  panes: readonly RenderScalePane[],
  now: number,
  hostGovernorEnabled = false,
): void {
  const governed = panes.filter((p) => p.renderScaleActive && p.renderScaleState.hasGovernor);
  if (!governed.length) return;

  if (!hostGovernorEnabled) {
    for (const pane of governed) {
      pane.renderScaleState.holdUnitScale();
      pane.applyRenderScale(1);
    }
    return;
  }

  const share = sharedRenderBudgetMs(panes);
  const entries: RenderScaleArbiterEntry[] = [];
  for (const pane of governed) {
    const governor = pane.renderScaleState.governorForArbiter();
    if (!governor) continue;
    const proposal = governor.evaluate({
      now,
      p95Ms: pane.renderScaleState.p95ForGovernor(),
      budgetMs: share,
    });
    entries.push({ governor, proposal });
  }

  arbitrateRenderScaleSteps(entries, now);

  for (const pane of governed) {
    pane.applyRenderScale(pane.renderScaleState.renderScale);
  }
}
