/**
 * #171 (b): the host's plugin-sky uniform contract, as data, for the install lint.
 *
 * The install lint is prebuilt into web/scripts/pack-install-lint.built.mjs and runs with only
 * web/scripts and plugins/sdk (#186), so it can't read the host sources the CI uniform lint reads
 * (`HOST_SKY_PREAMBLE_SOURCE`, `PLUGIN_SKY_UNIFORMS_SOURCE` in pack-lint-uniforms.ts). This snapshot is
 * what it lints a pack against instead; web/src/plugins/pack-install-uniforms-171b.test.ts pins it to
 * those sources, so a host edit that isn't copied here fails CI.
 */
export type HostUniformContract = {
  /** Every uniform the host sky preamble declares (`wrapPluginSky`), in source order. */
  readonly preamble: readonly { readonly name: string; readonly type: string }[];
  /** `PLUGIN_SKY_UNIFORMS`: the sky uniforms a pack may write (the default plugin.yml `viz.uniforms`). */
  readonly skyUniforms: readonly string[];
};

export const HOST_UNIFORM_CONTRACT: HostUniformContract = {
  preamble: [
    { name: "zotoVizSlots", type: "vec4" },
    { name: "uResolution", type: "vec2" },
    { name: "uTime", type: "float" },
    { name: "uOpacity", type: "float" },
    { name: "uBright", type: "float" },
    { name: "uAudio", type: "float" },
    { name: "uAccent", type: "vec3" },
    { name: "uBg", type: "vec3" },
    { name: "uRenderScale", type: "float" },
  ],
  skyUniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg", "uRenderScale"],
};
