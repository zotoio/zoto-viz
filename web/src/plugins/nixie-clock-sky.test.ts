import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/nixie-clock/sky/fragment.glsl?raw";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

describe("nixie-clock sky GLSL", () => {
  it("A7: wrapped nixie fragment compiles with 0 errors (counting GL probe)", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });
});
