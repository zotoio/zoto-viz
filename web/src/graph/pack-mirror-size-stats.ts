/** Allocation counter for `deviceSizeFromCssBox` (hot path uses `deviceSizeFromCssBoxInto`). */
export const packMirrorSizeStats = {
  deviceSizeAllocated: 0,
  reset(): void {
    this.deviceSizeAllocated = 0;
  },
};
