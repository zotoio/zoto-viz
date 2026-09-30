/**
 * Standalone zoto iframe host API types for plugin packs (zero runtime imports).
 */

export type ZotoUniformValue = number | [number, number, number];

/** Host-injected `window.zoto` surface for viz + config.read packs. */
export interface ZotoVizPluginHost<TFrame> {
  onFrame: ((frame: TFrame) => void) | null;
  onConfig: ((config: Record<string, string>) => void) | null;
  onTick?: ((nodes: unknown) => void) | null;
  getConfig?: () => Record<string, string>;
  writeBuffer: (slot: number, data: number[] | Float32Array) => void;
  writeUniform: (name: string, value: ZotoUniformValue) => void;
  /** @deprecated #184: no host renderer draws pack particles; draw from the sky's UBO slots (writeBuffer + zotoVizSlots). */
  writeParticles?: (data: number[] | Float32Array, stride?: number) => void;
  setStyle?: (style: unknown) => void;
  setNodeColor?: (id: string, hex: string) => void;
}
