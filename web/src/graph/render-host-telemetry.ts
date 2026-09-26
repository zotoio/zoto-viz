/** Counting hooks for render-host frame-loop tests (no timing). */
export const renderHostMirrorTelemetry = {
  scopeSyncRuns: 0,
  viewSortRuns: 0,
  /** Frames that entered `syncMirrorScopesIfNeeded` (dirty-flag check). */
  scopeDirtyChecks: 0,
  /** Times `getContextAttributes` was read to refresh the antialias cache. */
  getContextAttributesCalls: 0,
  reset(): void {
    this.scopeSyncRuns = 0;
    this.viewSortRuns = 0;
    this.scopeDirtyChecks = 0;
    this.getContextAttributesCalls = 0;
  },
};
