import { sanitizePackDisplayName } from "./sanitize-pack-name";

export const GFX_INTERRUPTED_NOTICE = "Graphics were interrupted. Restoring the wall…";
export const GFX_NO_RESTORE_NOTICE = "Graphics didn't come back. Reload to restore the wall.";

/** Host copy when a pack does not ship {@link VizPackFallbackText}. */
export function genericShaderFallbackMessage(packName: string): string {
  const name = sanitizePackDisplayName(packName) || "This view";
  return `‹${name}› can't run its graphics on this device. Other tiles aren't affected.`;
}
