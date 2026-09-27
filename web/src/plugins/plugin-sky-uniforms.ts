/** Frozen whitelist of uniforms plugin sky shaders may declare. */
export const PLUGIN_SKY_UNIFORMS = [
  "uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg", "uRenderScale",
] as const;

/** Host-written uniforms always injected for plugin skies (pack data block unchanged). */
export const PLUGIN_SKY_HOST_UNIFORMS = ["uResolution"] as const;
