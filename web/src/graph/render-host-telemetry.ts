/** Counting hooks for render-host frame-loop tests (no timing). */
export const renderHostMirrorTelemetry = {
  scopeSyncRuns: 0,
  viewSortRuns: 0,
  reset(): void {
    this.scopeSyncRuns = 0;
    this.viewSortRuns = 0;
  },
};
