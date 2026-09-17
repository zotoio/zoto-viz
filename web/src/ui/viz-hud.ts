import type { StateMsg } from "../core/types";
import type { VizDataFrame, VizFrameBudgetStats, VizTalkerSample } from "../plugins/viz-host";

/** First-party demoscene viz packs that share the host UBO frame. */
export const VIZ_DEMO_PACKS = ["packet-tunnel", "rf-constellation", "talker-storm"] as const;
export type VizDemoPackId = (typeof VIZ_DEMO_PACKS)[number];

const PACK_LABELS: Record<VizDemoPackId, string> = {
  "packet-tunnel": "tunnel",
  "rf-constellation": "RF",
  "talker-storm": "storm",
};

const SKIP_WINDOW_MS = 1000;
const SKIP_PULSE_MS = 400;

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

export function vizHudMetric(
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
        const top = talkers[0]!;
        const particles = estimateTalkerParticles(talkers);
        return { label: "particles", value: String(particles) };
      }
      return { label: "talkers", value: "0" };
    }
  }
}

/** Rolling skip rate over the last ~1 s from the host cumulative skip counter. */
export function skipRatePerSec(
  samples: readonly { t: number; n: number }[],
  now: number,
  windowMs = SKIP_WINDOW_MS,
): number {
  const cutoff = now - windowMs;
  let total = 0;
  let oldest = now;
  for (const s of samples) {
    if (s.t < cutoff) continue;
    total += s.n;
    if (s.t < oldest) oldest = s.t;
  }
  const span = Math.min(windowMs, Math.max(1, now - oldest));
  return (total / span) * 1000;
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
export class VizHud {
  readonly root: HTMLElement;
  private readonly packEl: HTMLElement;
  private readonly metricLabelEl: HTMLElement;
  private readonly metricValueEl: HTMLElement;
  private readonly skipEl: HTMLElement;
  private readonly swapRow: HTMLElement;
  private readonly onSwap: (packId: VizDemoPackId) => void;

  private activeId: VizDemoPackId | null = null;
  private lastSkipped = 0;
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
    this.skipEl.title = "Host viz frame skips (over 16.7 ms budget), rolling 1 s";

    this.swapRow = document.createElement("div");
    this.swapRow.className = "viz-hud-swap";
    for (const id of VIZ_DEMO_PACKS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "viz-hud-swap-btn";
      btn.textContent = PACK_LABELS[id];
      btn.title = id;
      btn.dataset.pack = id;
      btn.addEventListener("click", () => this.onSwap(id));
      this.swapRow.append(btn);
    }

    const sep = () => {
      const el = document.createElement("span");
      el.className = "viz-hud-sep";
      el.textContent = "·";
      return el;
    };
    line.append(this.packEl, sep(), metric, sep(), this.skipEl, this.swapRow);
    root.append(line);

    parent.append(root);
    this.root = root;
  }

  setActive(packId: string | null, packName: string): void {
    this.activeId = normalizeVizDemoPackId(packId);
    this.root.hidden = !this.activeId;
    if (!this.activeId) return;
    this.packEl.textContent = packName;
    for (const btn of this.swapRow.querySelectorAll<HTMLButtonElement>(".viz-hud-swap-btn")) {
      btn.classList.toggle("active", btn.dataset.pack === this.activeId);
    }
  }

  tick(input: VizHudTick): void {
    if (!this.activeId) return;
    const { stats, frame, state, now } = input;
    const metric = vizHudMetric(this.activeId, frame, state);
    this.metricLabelEl.textContent = metric.label;
    this.metricValueEl.textContent = metric.value;

    const delta = stats.skipped - this.lastSkipped;
    this.lastSkipped = stats.skipped;
    if (delta > 0) {
      this.skipSamples.push({ t: now, n: delta });
      this.pulseUntil = now + SKIP_PULSE_MS;
    }
    const cutoff = now - SKIP_WINDOW_MS;
    while (this.skipSamples.length && this.skipSamples[0].t < cutoff) this.skipSamples.shift();

    this.skipEl.textContent = formatSkipRate(skipRatePerSec(this.skipSamples, now));
    this.skipEl.classList.toggle("pulse", isSkipPulsing(now, this.pulseUntil));
  }
}
