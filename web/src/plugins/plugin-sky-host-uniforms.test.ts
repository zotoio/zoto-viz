import { describe, expect, it } from "vitest";
import { PLUGIN_SKY_HOST_UNIFORMS, PLUGIN_SKY_UNIFORMS } from "./plugin-sky-uniforms";
import { wrapPluginSky } from "../graph/backdrop";

describe("plugin sky host uniforms", () => {
  it("lists uResolution as host-only and uRenderScale as pack-opt-in", () => {
    expect(PLUGIN_SKY_HOST_UNIFORMS).toEqual(["uResolution"]);
    expect(PLUGIN_SKY_UNIFORMS).toContain("uRenderScale");
  });

  it("injects uResolution and uRenderScale into wrapped plugin skies", () => {
    const wrapped = wrapPluginSky(`
uniform vec2 uResolution;
void main() {
  fragColor = vec4(uResolution / 512.0, 0.0, 1.0);
}
`);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("uniform vec2 uResolution");
    expect(wrapped.frag).toContain("uniform float uRenderScale");
  });
});
