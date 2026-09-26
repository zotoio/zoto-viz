/** Allocation counters on the pack-mirror render path (hot path should stay at zero after warm-up). */
export const packMirrorSizeStats = {
  deviceSizeAllocated: 0,
  converterEdgeObjectsAllocated: 0,
  reset(): void {
    this.deviceSizeAllocated = 0;
    this.converterEdgeObjectsAllocated = 0;
  },
};
