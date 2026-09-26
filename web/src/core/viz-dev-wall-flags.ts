import {
  setVizBuildCostTicksForTileInjector,
  setVizWallClockInjector,
} from "./viz-clock";

let tileCostParseCount = 0;
let wallClockParseCount = 0;

/** Per-scoped-tile injected build cost (ticks); undefined slot = no override. */
const tileCostTicks = new Map<string, number>();

let showPerTileHudIndex = false;
const tileHudIndexById = new Map<string, number>();

let wallAnchorRealMs = 0;
let wallAnchorDevMs = 0;
let wallDevActive = false;

export function resetDevWallFlagParseCountsForTest(): void {
  tileCostParseCount = 0;
  wallClockParseCount = 0;
}

export function devWallFlagParseCounts(): { vizTileCostTicks: number; vizWallClock: number } {
  return { vizTileCostTicks: tileCostParseCount, vizWallClock: wallClockParseCount };
}

export function devShowPerTileHudIndex(): boolean {
  return import.meta.env.DEV && showPerTileHudIndex;
}

export function devPerTileHudIndexForTileId(tileId: string): number | undefined {
  return tileHudIndexById.get(tileId);
}

function clearInjectors(): void {
  tileCostTicks.clear();
  tileHudIndexById.clear();
  showPerTileHudIndex = false;
  wallDevActive = false;
  setVizBuildCostTicksForTileInjector(undefined);
  setVizWallClockInjector(undefined);
}

function parseTileCostFlag(raw: string | null, scopedTileIds: readonly string[]): void {
  tileCostParseCount++;
  if (!raw) return;

  const colon = raw.indexOf(":");
  if (colon < 0) return;

  const idx1 = Number(raw.slice(0, colon));
  const ticks = Number(raw.slice(colon + 1));
  if (!Number.isInteger(idx1) || !Number.isFinite(ticks) || idx1 < 1 || idx1 > scopedTileIds.length) return;
  if (ticks < 0) return;

  const tileId = scopedTileIds[idx1 - 1]!;
  tileCostTicks.set(tileId, ticks);
  for (let i = 0; i < scopedTileIds.length; i++) {
    tileHudIndexById.set(scopedTileIds[i]!, i + 1);
  }
  showPerTileHudIndex = true;
  setVizBuildCostTicksForTileInjector((tileId) => tileCostTicks.get(tileId));
}

function parseWallClockFlag(raw: string | null): void {
  wallClockParseCount++;
  if (!raw) return;

  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return;

  wallAnchorDevMs = Date.UTC(2024, 5, 15, h, min, 0, 0);
  wallAnchorRealMs = Date.now();
  wallDevActive = true;
  setVizWallClockInjector(() => {
    if (!wallDevActive) return Date.now();
    return wallAnchorDevMs + (Date.now() - wallAnchorRealMs);
  });
}

/**
 * Dev-only URL flags for dogfood: parse once when the mosaic wall is built (and on rebuild).
 * Steady frames read only numeric injectors — no URL parsing on the hot path.
 */
export function applyDevVizWallFlagsOnBuild(search: string, scopedTileIds: readonly string[]): void {
  clearInjectors();
  if (!import.meta.env.DEV) return;

  try {
    const params = new URLSearchParams(search);
    parseTileCostFlag(params.get("vizTileCostTicks"), scopedTileIds);
    parseWallClockFlag(params.get("vizWallClock"));
  } catch {
    // ignored — never throw or log from dev flag parsing
  }
}
