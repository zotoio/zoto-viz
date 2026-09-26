/**
 * Injectable clocks for viz:
 * - {@link vizClockMs} — monotonic budget / dt / HUD (defaults to `performance.now()`).
 * - {@link vizWallMs} — wall epoch ms for display (`ts`, nixie); defaults to `Date.now()`.
 */

let clockMs: () => number = () => performance.now();
let wallMs: () => number = () => Date.now();
let buildCostMs: ((deliverIndex: number) => number) | undefined;
let buildCostTicks: ((deliverIndex: number) => number) | undefined;
let buildCostTicksForTile: ((tileId: string, deliverIndex: number) => number | undefined) | undefined;

/** Monotonic host clock for frame budget, dt, and HUD skip rate. */
export function vizClockMs(): number {
  return clockMs();
}

/** Wall epoch clock for display (`state.ts`, nixie digits). */
export function vizWallMs(): number {
  return wallMs();
}

/** Wall epoch seconds for viz frames (`state.ts` when set). */
export function vizFrameEpochSec(stateTs?: number): number {
  return stateTs || vizWallMs() / 1000;
}

/** Override monotonic viz clock (pass `undefined` to restore default). */
export function setVizClockInjector(inject: (() => number) | undefined): void {
  clockMs = inject ?? (() => performance.now());
}

/** Override wall epoch clock (pass `undefined` to restore default). */
export function setVizWallClockInjector(inject: (() => number) | undefined): void {
  wallMs = inject ?? (() => Date.now());
}

/**
 * When set, {@link VizFrameBudget.deliver} records this duration instead of measuring build time.
 * Pass `undefined` to restore real measurement.
 */
export function setVizBuildCostInjector(
  inject: ((deliverIndex: number) => number) | undefined,
): void {
  buildCostMs = inject;
}

/** Read injected build cost for deliver index, or undefined to measure normally. */
export function vizBuildCostMs(deliverIndex: number): number | undefined {
  return buildCostMs?.(deliverIndex);
}

export function setVizBuildCostTicksInjector(
  inject: ((deliverIndex: number) => number) | undefined,
): void {
  buildCostTicks = inject;
}

export function vizBuildCostTicks(deliverIndex: number): number | undefined {
  return buildCostTicks?.(deliverIndex);
}

export function setVizBuildCostTicksForTileInjector(
  inject: ((tileId: string, deliverIndex: number) => number | undefined) | undefined,
): void {
  buildCostTicksForTile = inject;
}

export function vizBuildCostTicksForTile(tileId: string, deliverIndex: number): number | undefined {
  const perTile = buildCostTicksForTile?.(tileId, deliverIndex);
  if (perTile !== undefined) return perTile;
  return buildCostTicks?.(deliverIndex);
}

export function resetVizClockInjectors(): void {
  clockMs = () => performance.now();
  wallMs = () => Date.now();
  buildCostMs = undefined;
  buildCostTicks = undefined;
  buildCostTicksForTile = undefined;
}
