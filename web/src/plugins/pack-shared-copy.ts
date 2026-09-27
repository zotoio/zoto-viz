/** Shared user-facing copy for pack / mosaic drawer behaviour. */

export const NEST_NO_CAMERAS = "No cameras found for this Nest account.";

export function packLastTileDiscardMessage(packName: string): string {
  return `Your unsaved ${packName} changes were discarded because its last tile was removed.`;
}

/** Per-tile instance drawer scope note (`textContent` only; pack name is embedded like discard copy). */
export function perTilePackScopeNoteMessage(packName: string): string {
  return `These settings apply to this tile only. Anything you change here overrides the shared ${packName} settings.`;
}
