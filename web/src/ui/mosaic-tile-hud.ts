import {
  formatSkipRate,
  skipRatePerSec,
  vizHudMetric,
  type VizDemoPackId,
  type VizHudTick,
} from "./viz-hud";

const SKIP_WINDOW_MS = 1000;

export type MosaicTileHudStrip = {
  root: HTMLElement;
  tick: (input: VizHudTick) => void;
  detach: () => void;
};

function makeStrip(): MosaicTileHudStrip {
  const root = document.createElement("div");
  root.className = "mosaic-tile-hud";
  const packEl = document.createElement("span");
  packEl.className = "viz-hud-pack";
  const metricLabel = document.createElement("span");
  metricLabel.className = "viz-hud-metric-label";
  const metricValue = document.createElement("strong");
  metricValue.className = "viz-hud-metric-value";
  const metric = document.createElement("span");
  metric.className = "viz-hud-metric";
  metric.append(metricLabel, " ", metricValue);
  const skipEl = document.createElement("span");
  skipEl.className = "viz-hud-skip";
  const sep = () => {
    const s = document.createElement("span");
    s.className = "viz-hud-sep";
    s.textContent = "·";
    return s;
  };
  root.append(packEl, sep(), metric, sep(), skipEl);
  let lastSkipped = 0;
  const skipSamples: { t: number; n: number }[] = [];
  return {
    root,
    tick(input) {
      if (!input.packId) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      packEl.textContent = input.packName || input.packId;
      const m = vizHudMetric(input.packId, input.frame, input.state);
      metricLabel.textContent = m.label;
      metricValue.textContent = m.value;
      const delta = input.stats.skipped - lastSkipped;
      lastSkipped = input.stats.skipped;
      if (delta > 0) skipSamples.push({ t: input.now, n: delta });
      const cutoff = input.now - SKIP_WINDOW_MS;
      while (skipSamples.length && skipSamples[0].t < cutoff) skipSamples.shift();
      skipEl.textContent = formatSkipRate(skipRatePerSec(skipSamples, input.now));
    },
    detach() {
      root.remove();
    },
  };
}

/** One HUD strip per mosaic tile, pinned to the pane edge (not the scaled picture). */
export class MosaicTileHudLayer {
  private strips = new Map<string, MosaicTileHudStrip>();

  sync(tileSlotIds: readonly string[], paneFor: (slot: string) => HTMLElement | null): void {
    const want = new Set(tileSlotIds);
    for (const id of [...this.strips.keys()]) {
      if (!want.has(id)) {
        this.strips.get(id)!.detach();
        this.strips.delete(id);
      }
    }
    for (const slot of tileSlotIds) {
      const pane = paneFor(slot);
      if (!pane) continue;
      let strip = this.strips.get(slot);
      if (!strip) {
        strip = makeStrip();
        this.strips.set(slot, strip);
      }
      if (!strip.root.parentElement) pane.appendChild(strip.root);
    }
  }

  tickForPack(
    packId: VizDemoPackId,
    packName: string,
    tileSlotIds: readonly string[],
    input: Omit<VizHudTick, "packId" | "packName">,
  ): void {
    const tick: VizHudTick = { ...input, packId, packName };
    for (const slot of tileSlotIds) this.strips.get(slot)?.tick(tick);
  }

  clear(): void {
    for (const s of this.strips.values()) s.detach();
    this.strips.clear();
  }
}
