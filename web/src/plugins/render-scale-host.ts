import type { RenderScaleConfig } from "./render-scale-governor";
import { RenderScaleGovernor } from "./render-scale-governor";
import type { VizFrameBudgetStats } from "./viz-host";
import { VizFrameBudget, VIZ_FRAME_BUDGET_MS } from "./viz-host";

/** Per-view adaptive render scale (one governor + timing window per pane). */
export class RenderScaleViewState {
  readonly frameBudget = new VizFrameBudget();
  private governor: RenderScaleGovernor | null = null;
  private config: RenderScaleConfig | null = null;
  private scale = 1;
  private lastAnimTs = -1;

  get renderScale(): number {
    return this.config ? this.scale : 1;
  }

  get hasGovernor(): boolean {
    return this.config != null;
  }

  configure(config: RenderScaleConfig | null | undefined): void {
    this.config = config ?? null;
    if (!this.config) {
      this.governor = null;
      this.scale = 1;
      this.frameBudget.reset();
      this.lastAnimTs = -1;
      return;
    }
    this.governor = new RenderScaleGovernor(this.config);
    this.scale = this.governor.scale;
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

  tickGovernor(now: number, budgetMs: number): number {
    if (!this.governor) return 1;
    this.scale = this.governor.tick({
      now,
      p95Ms: this.frameBudget.p95ForGovernor(),
      budgetMs,
    });
    return this.scale;
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

/** Advance every pane governor that declared `render.scale`. */
export function tickRenderScalePanes(panes: readonly RenderScalePane[], now: number): void {
  const share = sharedRenderBudgetMs(panes);
  for (const pane of panes) {
    if (!pane.renderScaleActive || !pane.renderScaleState.hasGovernor) continue;
    const scale = pane.renderScaleState.tickGovernor(now, share);
    pane.applyRenderScale(scale);
  }
}
