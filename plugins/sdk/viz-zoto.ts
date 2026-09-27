/**
 * Sandbox `globalThis.zoto` API for viz plugin packs (iframe after host SDK boots).
 * Import `VizZoto` with `import type` only. String constants exported here are safe to value-import.
 *
 * Later host contract additions (e.g. `setConfig` in #36, `onPresent` in #37) extend
 * this interface in place; do not add parallel type files.
 */

import type { VizDataFrame } from "./viz-contract";

export type VizZotoUniformValue = number | [number, number, number];

export interface VizZoto {
  onTick: ((nodes: { id: string; rate: number; role: string }[]) => void) | null;
  onConfig: ((cfg: Record<string, string>) => void) | null;
  onFrame: ((frame: VizDataFrame) => void) | null;
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: VizZotoUniformValue) => void;
  writeParticles: (data: number[] | Float32Array, stride?: number) => void;
  getConfig?: () => Record<string, string>;
}

/** Repo path packs should import for `VizZoto` (lint messages reference this). */
export const VIZ_ZOTO_TYPE_MODULE = "plugins/sdk/viz-zoto";

export const PACK_ZOTO_BINDING_HINT =
  `Use getVizZoto() from "${VIZ_ZOTO_TYPE_MODULE}" (e.g. const host = getVizZoto();), not a top-level zoto binding.`;

export const INLINE_ZOTO_DECLARE_HINT =
  `Use getVizZoto() from "${VIZ_ZOTO_TYPE_MODULE}" instead of an inline zoto declaration.`;

/** Typed host object in the sandbox iframe (safe with the host module wrapper). */
export function getVizZoto(): VizZoto {
  return (globalThis as unknown as { zoto: VizZoto }).zoto;
}
