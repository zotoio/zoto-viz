/** Standalone arcade tile: host viz clock delta (not rAF `performance.now`). */
export function vizClockStepSec(state: { lastMs: number }, clockMs: () => number): number {
  const ms = clockMs();
  const dtSec = state.lastMs ? Math.min(0.05, (ms - state.lastMs) / 1000) : 0;
  state.lastMs = ms;
  return dtSec;
}

export function resetVizClockStep(state: { lastMs: number }): void {
  state.lastMs = 0;
}
