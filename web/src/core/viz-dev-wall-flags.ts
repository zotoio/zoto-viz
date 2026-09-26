import { setVizBuildCostTicksInjector } from "./viz-clock";
import { vizClockMs } from "./viz-clock";
import { clearDevWallFlagClock, devWallFlagClockActive, setDevWallFlagClock } from "../plugins/nixie-wall-parts";

let lastParsedWallClockRaw: string | null = null;

function clearWallCostInjector(): void {
  setVizBuildCostTicksInjector(undefined);
}

/** Decimal integer string only (no hex, floats, or exponent). */
function parseDecimalIntToken(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** Whole-wall `?vizTileCostTicks=<ticks>` only; every `index:ticks` form is rejected. */
function parseWallCostTicksFlag(raw: string | null): void {
  if (raw === null || raw === undefined) return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  if (trimmed.indexOf(":") >= 0) return;

  const ticks = parseDecimalIntToken(trimmed);
  if (ticks === null || ticks < 0) return;

  setVizBuildCostTicksInjector(() => ticks);
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
export function applyDevVizWallFlagsOnBuild(search: string, _scopedTileIds: readonly string[]): void {
  clearWallCostInjector();
  if (!import.meta.env.DEV) return;

  try {
    const params = new URLSearchParams(search);
    parseWallCostTicksFlag(params.get("vizTileCostTicks"));
    parseWallClockFlag(params.get("vizWallClock"));
  } catch {
    // ignored — never throw or log from dev flag parsing
  }
}

/** Test hook: reset wall-clock anchor bookkeeping between cases. */
export function resetDevVizWallFlagsStateForTests(): void {
  clearWallCostInjector();
  lastParsedWallClockRaw = null;
  clearDevWallFlagClock();
}
