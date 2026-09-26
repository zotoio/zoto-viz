/**
 * Injectable host clock for viz frame budget + HUD skip rate (defaults to real time).
 * Tests drive a simulated clock and optional per-deliver build costs.
 */

let clockMs: () => number = () => performance.now();
let buildCostMs: ((deliverIndex: number) => number) | undefined;

/** Wall time in ms for viz budget / HUD (not rAF present timestamps). */
export function vizClockMs(): number {
  return clockMs();
}

/** Override viz wall clock (pass `undefined` to restore default). */
export function setVizClockInjector(inject: (() => number) | undefined): void {
  clockMs = inject ?? (() => performance.now());
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

export function resetVizClockInjectors(): void {
  clockMs = () => performance.now();
  buildCostMs = undefined;
}
