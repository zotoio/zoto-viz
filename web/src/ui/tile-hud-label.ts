import { tileLimitedSharingLabel } from "./viz-copy";

export interface TileHudLabelStats {
  builds: number;
  writes: number;
}

let stats: TileHudLabelStats = { builds: 0, writes: 0 };
let lastMates = -1;
let lastRateKey = "";
let cachedLabel: string | null = null;

export function resetTileHudLabelStats(): void {
  stats = { builds: 0, writes: 0 };
  lastMates = -1;
  lastRateKey = "";
  cachedLabel = null;
}

export function tileHudLabelStats(): TileHudLabelStats {
  return { ...stats };
}

/** Build LIMITED label only when tile count (mates) or skip-rate bucket changes. */
export function limitedSharingLabelCached(activeTiles: number, skipsPerSec: number): string | null {
  if (activeTiles < 2) {
    cachedLabel = null;
    lastMates = -1;
    lastRateKey = "";
    return null;
  }
  const mates = activeTiles - 1;
  const rateKey = skipsPerSec < 0.05 ? "0" : (skipsPerSec < 10 ? skipsPerSec.toFixed(1) : String(Math.round(skipsPerSec)));
  if (mates === lastMates && rateKey === lastRateKey && cachedLabel !== null) {
    return cachedLabel;
  }
  lastMates = mates;
  lastRateKey = rateKey;
  stats.builds++;
  cachedLabel = tileLimitedSharingLabel(activeTiles, skipsPerSec);
  return cachedLabel;
}

/** Revert path: rebuild LIMITED copy every tick (dogfood red row). */
export function limitedSharingLabelEveryTick(activeTiles: number, skipsPerSec: number): string | null {
  if (activeTiles < 2) return null;
  stats.builds++;
  return tileLimitedSharingLabel(activeTiles, skipsPerSec);
}

export function writeHudSkipText(el: HTMLElement, text: string): void {
  if (el.textContent === text) return;
  stats.writes++;
  el.textContent = text;
}
