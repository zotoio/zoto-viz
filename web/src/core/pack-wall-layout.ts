export const ALLOWED_WALL_LAYOUT_MOSAIC = new Set(["off", "4", "6", "8", "16"]);

export function wallLayoutMosaicError(relPath: string, value: string): string {
  return `wall-layout.yml ${relPath}: look.mosaic must be one of off, 4, 6, 8, 16 (got "${value}")`;
}

function validateLookMosaic(relPath: string, look: unknown): void {
  if (!look || typeof look !== "object") return;
  const raw = (look as Record<string, unknown>).mosaic;
  if (raw === undefined || raw === null) return;
  const value = String(raw).trim();
  if (ALLOWED_WALL_LAYOUT_MOSAIC.has(value)) return;
  throw new Error(wallLayoutMosaicError(relPath, value));
}

/** Validate parsed wall-layout.yml (preset name → block). */
export function validateWallLayoutDoc(doc: unknown, relPath = "wall-layout.yml"): void {
  if (doc === null || doc === undefined) return;
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`wall-layout.yml ${relPath}: root must be a mapping`);
  }
  for (const [key, block] of Object.entries(doc as Record<string, unknown>)) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const look = (block as Record<string, unknown>).look;
    if (look !== undefined) {
      validateLookMosaic(`${relPath} ${key}.look`, look);
    }
  }
}
