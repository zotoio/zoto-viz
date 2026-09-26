/** Shared user-facing copy for pack / mosaic drawer behaviour. */

export const NEST_NO_CAMERAS = "No cameras found for this Nest account.";

export function packLastTileDiscardMessage(packName: string): string {
  return `Your unsaved ${packName} changes were discarded because its last tile was removed.`;
}
