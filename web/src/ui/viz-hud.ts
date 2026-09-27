import type { StateMsg } from "../core/types";
import { formatVizBudgetOverlay, vizBudgetOverlayFromStats } from "../plugins/viz-budget-overlay";
import type { VizDataFrame, VizFrameBudgetStats, VizTalkerSample } from "../plugins/viz-host";
import { morphCopy, Select } from "./ui";

/** First-party demoscene viz packs that share the host UBO frame. */
export const VIZ_DEMO_PACKS = [
  "packet-tunnel", "rf-constellation", "talker-storm",
  "kefrens-bars", "roto-proto", "blob-mesh", "star-sines", "hn-rain", "hn-term",
  "stereo-gram", "nixie-clock",
] as const;
export type VizDemoPackId = (typeof VIZ_DEMO_PACKS)[number];

const PACK_LABELS: Record<VizDemoPackId, string> = {
  "packet-tunnel": "tunnel",
  "rf-constellation": "RF",
  "talker-storm": "storm",
  "kefrens-bars": "kefrens",
  "roto-proto": "roto",
  "blob-mesh": "blobs",
  "star-sines": "sines",
  "hn-rain": "HN",
  "hn-term": "term",
  "stereo-gram": "stereo",
  "nixie-clock": "nixie",
};

const SKIP_WINDOW_MS = 1000;
const SKIP_PULSE_MS = 400;

type VizHudSlice = "packets" | "rf" | "talkers" | "headlines";

const PACK_HUD_SLICE: Partial<Record<VizDemoPackId, VizHudSlice>> = {
  "packet-tunnel": "packets",
  "rf-constellation": "rf",
  "talker-storm": "talkers",
  "kefrens-bars": "talkers",
  "roto-proto": "packets",
  "blob-mesh": "talkers",
  "star-sines": "packets",
  "hn-rain": "headlines",
  "hn-term": "headlines",
  "stereo-gram": "talkers",
};

function vizHudSliceDemo(packId: VizDemoPackId, frame: VizDataFrame | null): boolean {
  if (!frame) return false;
  const slice = PACK_HUD_SLICE[packId];
  if (slice && frame.demoSlices?.[slice]) return true;
  return frame.demo === true && !frame.demoSlices;
}

/** Strip `plugin:` view prefix and return a bare demo pack id, or null. */
export function normalizeVizDemoPackId(id: string | null | undefined): VizDemoPackId | null {
  if (!id) return null;
  const bare = id.startsWith("plugin:") ? id.slice("plugin:".length) : id;
  return VIZ_DEMO_PACKS.includes(bare as VizDemoPackId) ? (bare as VizDemoPackId) : null;
}

export function isVizDemoPack(id: string | null | undefined): id is VizDemoPackId {
  return normalizeVizDemoPackId(id) !== null;
}

export interface VizHudMetric {
  label: string;
  value: string;
}

export interface VizHudTick {
  packId: VizDemoPackId | null;
  packName: string;
  stats: VizFrameBudgetStats;
  frame: VizDataFrame | null;
  state: StateMsg;
  now: number;
  /** When set, show the frame-budget overlay (GPU/CPU ms, p95, scale). */
  renderScale?: number | null;
  governorEnabled?: boolean;
}

/** v2 contract exposes talker TCP failure ratios and systemd unit pressure — host maps them to a strip badge. */
export function vizFrameFailureBadge(frame: VizDataFrame | null): string | null {
  if (!frame) return null;
  let talkerPeak = 0;
  for (const t of frame.talkers) {
    if (typeof t.failed === "number") talkerPeak = Math.max(talkerPeak, t.failed);
  }
  const sysFail = frame.sys?.failed ?? 0;
  const failedUnits = sysFail > 0 ? Math.max(1, Math.round(sysFail * 4)) : 0;
  const parts: string[] = [];
  if (talkerPeak > 0) parts.push(`${Math.round(talkerPeak * 100)}% TCP`);
  if (failedUnits > 0) parts.push(`${failedUnits} unit${failedUnits === 1 ? "" : "s"}`);
  if (!parts.length) return null;
  return `⚠ DEGRADED ${parts.join(" · ")}`;
}

/** Estimate talker-storm particle count (mirrors the plugin cap, host-side only). */
export function estimateTalkerParticles(talkers: VizTalkerSample[]): number {
  let count = 0;
  for (const talker of talkers) {
    const n = Math.min(8, Math.ceil(talker.rate / 40));
    count += n;
    if (count >= 512) return 512;
  }
  return count;
}

function vizHudMetricLive(
  packId: VizDemoPackId,
  frame: VizDataFrame | null,
  state: StateMsg,
): VizHudMetric {
  switch (packId) {
    case "packet-tunnel":
      return { label: "flows", value: String(state.stats.active_flows) };
    case "rf-constellation": {
      const n = frame?.rf.length ?? state.views?.wifi?.watch?.ssids?.length ?? 0;
      return { label: "RF", value: String(n) };
    }
    case "talker-storm": {
      const talkers = frame?.talkers ?? [];
      if (talkers.length) {
        const particles = estimateTalkerParticles(talkers);
        return { label: "particles", value: String(particles) };
      }
      return { label: "talkers", value: "0" };
    }
    case "kefrens-bars":
      return { label: "talkers", value: String(frame?.talkers.length ?? 0) };
    case "roto-proto":
      return { label: "flows", value: String(state.stats.active_flows) };
    case "blob-mesh":
      return { label: "blobs", value: String(Math.min(8, frame?.talkers.length ?? 0)) };
    case "star-sines":
      return { label: "lanes", value: String(frame?.packets.length ?? 0) };
    case "hn-rain":
      return { label: "headlines", value: String(frame?.headlines.length ?? 0) };
    case "hn-term":
      return { label: "stories", value: String(frame?.headlines.length ?? 0) };
    case "stereo-gram":
      return { label: "talkers", value: String(frame?.talkers.length ?? 0) };
    case "nixie-clock":
      return { label: "nixie", value: "clock" };
  }
}

export function vizHudMetric(
  packId: VizDemoPackId,
  frame: VizDataFrame | null,
  state: StateMsg,
): VizHudMetric {
  const live = vizHudMetricLive(packId, frame, state);
  if (vizHudSliceDemo(packId, frame)) return { label: live.label, value: "demo" };
  return live;
}

const SKIP_RATE_CEILING = 240;

/** Rolling skip rate over the last ~1 s from the host cumulative skip counter. */
export function skipRatePerSec(
  samples: readonly { t: number; n: number }[],
  now: number,
  windowMs = SKIP_WINDOW_MS,
): number {
  const cutoff = now - windowMs;
  let total = 0;
  for (const s of samples) {
    if (s.t < cutoff) continue;
    total += s.n;
  }
  if (total <= 0) return 0;
  const rate = (total / windowMs) * 1000;
  return Math.min(rate, SKIP_RATE_CEILING);
}

export function formatSkipRate(rate: number): string {
  if (rate < 0.05) return "skips 0/s";
  const rounded = rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
  return `skips ${rounded}/s`;
}

export function isSkipPulsing(now: number, pulseUntil: number): boolean {
  return now < pulseUntil;
}

/**
 * CPU-only demoscene HUD: pack name, one primary metric, rolling skip rate, and
 * pack swap controls. Lives in `#viz-hud` over the scene (no extra GPU pass).
 */
function setHudText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class VizHud {
  readonly root: HTMLElement;
  private readonly packEl: HTMLElement;
  private readonly metricLabelEl: HTMLElement;
  private readonly metricValueEl: HTMLElement;
  private readonly skipEl: HTMLElement;
  private readonly budgetEl: HTMLElement;
  private readonly degradedEl: HTMLElement;
  private readonly degradedSepAfter: HTMLElement;
  private readonly stageFailEl: HTMLElement;
  private readonly swapRow: HTMLElement;
  private readonly packSel: Select;
  private readonly onSwap: (packId: VizDemoPackId) => void;

  private activeId: VizDemoPackId | null = null;
  private budgetVisible = false;
  private lastSkipped = 0;
  private skipNeedsSync = true;
  private readonly skipSamples: { t: number; n: number }[] = [];
  private pulseUntil = 0;

  constructor(parent: HTMLElement, onSwap: (packId: VizDemoPackId) => void) {
    this.onSwap = onSwap;
    const root = document.createElement("div");
    root.id = "viz-hud";
    root.className = "viz-hud";
    root.hidden = true;

    const line = document.createElement("div");
    line.className = "viz-hud-line";

    this.packEl = document.createElement("span");
    this.packEl.className = "viz-hud-pack";

    const metric = document.createElement("span");
    metric.className = "viz-hud-metric";
    this.metricLabelEl = document.createElement("span");
    this.metricLabelEl.className = "viz-hud-metric-label";
    this.metricValueEl = document.createElement("strong");
    this.metricValueEl.className = "viz-hud-metric-value";
    metric.append(this.metricLabelEl, " ", this.metricValueEl);

    this.skipEl = document.createElement("span");
    this.skipEl.className = "viz-hud-skip";
    this.skipEl.title = "Frame skips when build or present-to-present exceeds 16.7 ms, rolling 1 s";

    this.budgetEl = document.createElement("span");
    this.budgetEl.className = "viz-hud-budget";
    this.budgetEl.hidden = true;
    this.budgetEl.title = "Present or GPU frame time (unclamped) and p95 over a rolling window";
    this.degradedEl = document.createElement("span");
    this.degradedEl.className = "viz-hud-degraded";
    this.degradedEl.hidden = true;
    this.degradedEl.title = "Elevated per-host TCP failure ratio and/or failed systemd units (viz contract v2)";

    this.stageFailEl = document.createElement("div");
    this.stageFailEl.className = "viz-stage-fail-label";
    this.stageFailEl.hidden = true;
    this.stageFailEl.setAttribute("role", "status");
    this.stageFailEl.textContent = "⚠ DEGRADED";

    this.swapRow = document.createElement("div");
    this.swapRow.className = "viz-hud-swap";
    this.packSel = new Select({
      caption: "pack",
      title: "swap demoscene pack",
      filterable: true,
      options: VIZ_DEMO_PACKS.map((id) => ({ value: id, label: PACK_LABELS[id], hint: id, group: "demo" })),
      onChange: (id) => this.onSwap(id as VizDemoPackId),
    });
    this.swapRow.append(this.packSel.el);

    const sep = () => {
      const el = document.createElement("span");
      el.className = "viz-hud-sep";
      el.textContent = "·";
      return el;
    };
    line.append(this.packEl, sep(), metric, sep(), this.skipEl, sep(), this.budgetEl, this.swapRow);
    this.degradedSepAfter = sep();
    this.degradedSepAfter.hidden = true;
    line.append(
      this.packEl,
      sep(),
      metric,
      sep(),
      this.skipEl,
      sep(),
      this.degradedEl,
      this.degradedSepAfter,
      this.swapRow,
    );
    root.append(line);

    parent.append(this.stageFailEl, root);
    this.root = root;
  }

  setBudgetOverlayVisible(on: boolean): void {
    this.budgetVisible = on;
    this.budgetEl.hidden = !on;
  }

  setActive(packId: string | null, packName: string): void {
    const next = normalizeVizDemoPackId(packId);
    const changed = next !== this.activeId;
    this.activeId = next;
    this.root.hidden = !this.activeId;
    if (!this.activeId) {
      this.stageFailEl.hidden = true;
      this.stageFailEl.textContent = "⚠ DEGRADED";
      return;
    }
    if (changed) this.resetSkipBaseline();
    if (!this.packEl.textContent) this.packEl.textContent = packName;
    else morphCopy(this.packEl, packName);
    this.packSel.value = this.activeId;
  }

  /** Re-sync skip delta baseline after host budget reset (avoids desync / false bursts). */
  resetSkipBaseline(): void {
    this.skipSamples.length = 0;
    this.pulseUntil = 0;
    this.skipNeedsSync = true;
  }

  tick(input: VizHudTick): void {
    if (!this.activeId) return;
    const { stats, frame, state, now } = input;
    const metric = vizHudMetric(this.activeId, frame, state);
    setHudText(this.metricLabelEl, metric.label);
    setHudText(this.metricValueEl, metric.value);

    if (this.skipNeedsSync) {
      this.lastSkipped = stats.skipped;
      this.skipNeedsSync = false;
    } else {
      const delta = stats.skipped - this.lastSkipped;
      this.lastSkipped = stats.skipped;
      if (delta > 0) {
        this.skipSamples.push({ t: now, n: delta });
        this.pulseUntil = now + SKIP_PULSE_MS;
      }
    }
    const cutoff = now - SKIP_WINDOW_MS;
    while (this.skipSamples.length && this.skipSamples[0].t < cutoff) this.skipSamples.shift();

    setHudText(this.skipEl, formatSkipRate(skipRatePerSec(this.skipSamples, now)));
    this.skipEl.classList.toggle("pulse", isSkipPulsing(now, this.pulseUntil));

    if (this.budgetVisible) {
      const model = vizBudgetOverlayFromStats(
        stats,
        input.renderScale ?? null,
        input.governorEnabled ?? false,
      );
      this.budgetEl.textContent = formatVizBudgetOverlay(model);
    const failBadge = vizFrameFailureBadge(frame);
    if (failBadge) {
      this.degradedEl.hidden = false;
      this.degradedSepAfter.hidden = false;
      setHudText(this.degradedEl, failBadge);
      this.stageFailEl.hidden = false;
      setHudText(this.stageFailEl, failBadge);
    } else {
      this.degradedEl.hidden = true;
      this.degradedSepAfter.hidden = true;
      setHudText(this.degradedEl, "");
      this.stageFailEl.hidden = true;
      setHudText(this.stageFailEl, "⚠ DEGRADED");
    }
  }
}
