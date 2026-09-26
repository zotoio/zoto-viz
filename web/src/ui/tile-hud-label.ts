import { tileLimitedSharingLabel } from "./viz-copy";

export interface TileHudLabelStats {
  builds: number;
  writes: number;
}

export interface TileHudLabelLine {
  readonly stats: TileHudLabelStats;
  limitedLabel(activeTiles: number, skipsPerSec: number): string | null;
  writeText(el: HTMLElement, text: string): void;
  bumpBuild(): void;
  bumpWrite(): void;
  reset(): void;
}

function rateKey(skipsPerSec: number): string {
  if (skipsPerSec < 0.05) return "0";
  return skipsPerSec < 10 ? skipsPerSec.toFixed(1) : String(Math.round(skipsPerSec));
}

export function createTileHudLabelLine(): TileHudLabelLine {
  const stats: TileHudLabelStats = { builds: 0, writes: 0 };
  let lastTileCount = -1;
  let lastRateKey = "";
  let cachedLabel: string | null = null;

  return {
    get stats() {
      return { ...stats };
    },
    reset() {
      stats.builds = 0;
      stats.writes = 0;
      lastTileCount = -1;
      lastRateKey = "";
      cachedLabel = null;
    },
    limitedLabel(activeTiles: number, skipsPerSec: number): string | null {
      if (activeTiles < 2) {
        cachedLabel = null;
        lastTileCount = -1;
        lastRateKey = "";
        return null;
      }
      const key = rateKey(skipsPerSec);
      if (activeTiles === lastTileCount && key === lastRateKey && cachedLabel !== null) {
        return cachedLabel;
      }
      lastTileCount = activeTiles;
      lastRateKey = key;
      stats.builds++;
      cachedLabel = tileLimitedSharingLabel(activeTiles, skipsPerSec);
      return cachedLabel;
    },
    writeText(el: HTMLElement, text: string): void {
      if (el.textContent === text) return;
      stats.writes++;
      el.textContent = text;
    },
    bumpBuild() {
      stats.builds++;
    },
    bumpWrite() {
      stats.writes++;
    },
  };
}

