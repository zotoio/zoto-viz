/** Shared user-facing copy for pack / mosaic drawer behaviour. */
export function packLastTileDiscardMessage(packName: string): string {
  return `Your unsaved ${packName} changes were discarded because its last tile was removed.`;
}

export function nestNoCamerasFoundForAccount(): string {
  return "No cameras found for this Nest account.";
}
