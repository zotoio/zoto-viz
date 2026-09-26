/**
 * Type-only sandbox host API for viz plugin packs.
 * Import with `import type` — never bundled as a runtime dependency.
 */

import type { VizDataFrame } from "./viz-contract";

export type VizPackUniformValue = number | [number, number, number];

/** `globalThis.zoto` in the viz iframe after the host SDK boots. */
export interface VizPackZotoHost {
  onTick: ((nodes: { id: string; rate: number; role: string }[]) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  onFrame: ((frame: VizDataFrame) => void) | null;
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: VizPackUniformValue) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
  getConfig?: () => Record<string, string>;
}

/** Host does not expose mosaic tile pixel size in init/frame today — use this until a host field lands. */
export const VIZ_PACK_TILE_FALLBACK = { w: 1280, h: 800 } as const;
