import {
  setVizBuildCostTicksForTileInjector,
} from "./viz-clock";
import { vizClockMs } from "./viz-clock";
import { clearDevWallFlagClock, devWallFlagClockActive, setDevWallFlagClock } from "../plugins/nixie-wall-parts";

/** Per-scoped-tile injected build cost (ticks); undefined slot = no override. */
const tileCostTicks = new Map<string, number>();

let showPerTileHudIndex = false;
const tileHudIndexById = new Map<string, number>();
let lastParsedWallClockRaw: string | null = null;

function clearTileCostInjectors(): void {
  tileCostTicks.clear();
  tileHudIndexById.clear();
  showPerTileHudIndex = false;
  setVizBuildCostTicksForTileInjector(undefined);
}

/** Decimal integer string only (no hex, floats, or exponent). */
function parseDecimalIntToken(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function parseTileCostFlag(raw: string | null, scopedTileIds: readonly string[]): void {
  if (!raw) return;

  const colon = raw.indexOf(":");
  if (colon < 0) return;

  const idx1 = parseDecimalIntToken(raw.slice(0, colon));
  const ticks = parseDecimalIntToken(raw.slice(colon + 1));
  if (idx1 === null || ticks === null || idx1 < 1 || idx1 > scopedTileIds.length) return;
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
  if (!raw) {
    lastParsedWallClockRaw = null;
    clearDevWallFlagClock();
    return;
  }

  const trimmed = raw.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return;

  if (trimmed === lastParsedWallClockRaw && devWallFlagClockActive()) return;

  lastParsedWallClockRaw = trimmed;
  setDevWallFlagClock(h, min, vizClockMs());
}

/**
 * Dev-only URL flags for dogfood: parse once when the mosaic wall is built (and on rebuild).
 * Steady frames read only numeric injectors — no URL parsing on the hot path.
 */
export function applyDevVizWallFlagsOnBuild(search: string, scopedTileIds: readonly string[]): void {
  clearTileCostInjectors();
  if (!import.meta.env.DEV) return;

  try {
    const params = new URLSearchParams(search);
    parseTileCostFlag(params.get("vizTileCostTicks"), scopedTileIds);
    parseWallClockFlag(params.get("vizWallClock"));
  } catch {
    // ignored — never throw or log from dev flag parsing
  }
}

/** Test hook: reset wall-clock anchor bookkeeping between cases. */
export function resetDevVizWallFlagsStateForTests(): void {
  clearTileCostInjectors();
  lastParsedWallClockRaw = null;
  clearDevWallFlagClock();
}

export function devShowPerTileHudIndex(): boolean {
  return import.meta.env.DEV && showPerTileHudIndex;
}

export function devPerTileHudIndexForTileId(tileId: string): number | undefined {
  return tileHudIndexById.get(tileId);
}
