/**
 * A tile whose sky failed keeps the host sky already recovered for it.
 * A pack that draws its own sky is left alone, so the tile does not go black.
 */
export function hostSkyForFailedTile<T extends string>(packBackdrop: string | undefined, recovered: T): T | null {
  if (packBackdrop === "plugin") return null;
  return recovered;
}
