/** Host-owned frame uniform block (separate from plugin slot mirror). */

export const VIZ_FRAME_UBO_VERSION = 1;

/** std140 vec4 `zotoVizFrame` — versioned; packs read only. */
export const VIZ_FRAME_UBO = {
  version: VIZ_FRAME_UBO_VERSION,
  threeUniform: "zotoVizFrame",
  /** Float index in the host `Float32Array(4)` mirror. */
  renderScaleOffset: 0,
  layoutVersionOffset: 1,
  totalFloats: 4,
} as const;

export const VIZ_FRAME_UBO_GLSL = `uniform vec4 ${VIZ_FRAME_UBO.threeUniform};`;

/** Write host frame fields into the 4-float mirror (no allocation). */
export function writeVizFrameUbo(buf: Float32Array, renderScale: number): void {
  buf[VIZ_FRAME_UBO.renderScaleOffset] = renderScale;
  buf[VIZ_FRAME_UBO.layoutVersionOffset] = VIZ_FRAME_UBO_VERSION;
  buf[2] = 0;
  buf[3] = 0;
}

/** Packs may sample `zotoVizFrame.x` as the active render scale (1 when governor inactive). */
export function readVizFrameRenderScale(buf: Float32Array): number {
  const s = buf[VIZ_FRAME_UBO.renderScaleOffset];
  return Number.isFinite(s) && s > 0 ? s : 1;
}
