/**
 * Type-only helpers for viz plugin packs.
 * Import with `import type` — never bundled as a runtime dependency.
 */

export type { VizZoto, VizZotoUniformValue } from "./viz-zoto";

/** Host does not expose mosaic tile pixel size in init/frame today — use this until a host field lands. */
export const VIZ_PACK_TILE_FALLBACK = { w: 1280, h: 800 } as const;
