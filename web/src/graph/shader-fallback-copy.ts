import { sanitizePackDisplayName } from "./sanitize-pack-name";

/** Host copy when a pack does not ship {@link VizPackFallbackText}. */
export function genericShaderFallbackMessage(packName: string): string {
  const name = sanitizePackDisplayName(packName) || "This view";
  return `‹${name}› can't run its graphics on this device. Other tiles aren't affected.`;
}
