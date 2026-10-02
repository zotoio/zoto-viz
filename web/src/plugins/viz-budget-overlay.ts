import type { VizFrameBudgetStats } from "./viz-host";

export type VizBudgetTimingSource = "gpu" | "cpu";

export interface VizBudgetOverlayModel {
  timingSource: VizBudgetTimingSource;
  lastMs: number | null;
  p95Ms: number | null;
  renderScale: number | null;
  /** Host adaptive governor (on by default; `?vizGovernor=0` forces off for one load). */
  governorEnabled: boolean;
}

/** Format overlay line: `gov on · GPU 12.4 ms · p95 14.1 · scale 0.75` or dashes when empty. */
export function formatVizBudgetOverlay(model: VizBudgetOverlayModel): string {
  const gov = model.governorEnabled ? "gov on" : "gov off";
  const src = model.timingSource === "gpu" ? "GPU" : "CPU";
  const last = model.lastMs == null || !Number.isFinite(model.lastMs) ? "—" : model.lastMs.toFixed(1);
  const p95 = model.p95Ms == null || !Number.isFinite(model.p95Ms) ? "—" : model.p95Ms.toFixed(1);
  const scale = model.renderScale == null ? "" : ` · scale ${formatScale(model.renderScale)}`;
  return `${gov} · ${src} ${last} ms · p95 ${p95}${scale}`;
}

function formatScale(s: number): string {
  if (Math.abs(s - 1) < 0.001) return "1";
  return s.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function vizBudgetOverlayFromStats(
  stats: VizFrameBudgetStats,
  renderScale: number | null,
  governorEnabled = false,
): VizBudgetOverlayModel {
  return {
    timingSource: stats.timingSource ?? "cpu",
    lastMs: stats.hasSamples ? stats.lastMs : null,
    p95Ms: stats.hasSamples ? (stats.p95Ms ?? stats.lastMs) : null,
    renderScale,
    governorEnabled,
  };
}
