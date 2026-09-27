/**
 * Shared viz pack host shims. Types are type-only; small runtime constants (e.g. tile
 * fallback) are bundled when value-imported from a pack entry.
 */

export type { VizZoto, VizZotoUniformValue } from "./viz-zoto";

/** Host does not expose mosaic tile pixel size in init/frame today — use this until a host field lands. */
export const VIZ_PACK_TILE_FALLBACK = { w: 1280, h: 800 } as const;
