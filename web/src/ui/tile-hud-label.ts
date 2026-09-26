import { tileLimitedSharingLabel } from "./viz-copy";

export interface TileHudLabelStats {
  builds: number;
  writes: number;
}

export interface TileHudLabelLine {
  readonly stats: TileHudLabelStats;
  limitedLabel(activeTiles: number, cadenceK: number): string | null;
  writeText(el: HTMLElement, text: string): void;
  bumpBuild(): void;
  bumpWrite(): void;
  reset(): void;
}

export function createTileHudLabelLine(): TileHudLabelLine {
  const stats: TileHudLabelStats = { builds: 0, writes: 0 };
  let lastTileCount = -1;
  let lastCadenceK = -1;
  let cachedLabel: string | null = null;

  return {
    get stats() {
      return { ...stats };
    },
    reset() {
      stats.builds = 0;
      stats.writes = 0;
      lastTileCount = -1;
      lastCadenceK = -1;
      cachedLabel = null;
    },
    limitedLabel(activeTiles: number, cadenceK: number): string | null {
      if (activeTiles < 2) {
        cachedLabel = null;
        lastTileCount = -1;
        lastCadenceK = -1;
        return null;
      }
      if (activeTiles === lastTileCount && cadenceK === lastCadenceK && cachedLabel !== null) {
        return cachedLabel;
      }
      lastTileCount = activeTiles;
      lastCadenceK = cadenceK;
      stats.builds++;
      cachedLabel = tileLimitedSharingLabel(activeTiles, cadenceK);
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

