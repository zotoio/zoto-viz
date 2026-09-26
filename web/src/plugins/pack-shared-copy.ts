/** Shared user-facing copy for pack / mosaic drawer behaviour. */

export const NEST_NO_CAMERAS = "No cameras found for this Nest account.";

/** Pack name pinned in `pack-shared-copy.literals.test.ts` for the discard copy row. */
export const PACK_SHARED_COPY_LITERAL_DISCARD_PACK = "Settings fixture";

export function packLastTileDiscardMessage(packName: string): string {
  return `Your unsaved ${packName} changes were discarded because its last tile was removed.`;
}

export function nestNoCamerasFoundForAccount(): string {
  return NEST_NO_CAMERAS;
}
