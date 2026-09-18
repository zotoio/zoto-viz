import { describe, expect, it } from "vitest";
import {
  BACKDROP_OPTIONS, CYCLE_SKIES, cycleSkyPool, Backdrop, RECIPE_EASE_MAX_S,
  PLUGIN_SKY_FALLBACK, pluginShaderError, wrapPluginSky, skyGroup,
} from "./backdrop";
import { liveCam } from "../camera/livecam";

const OK_FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = mix(uBg, uAccent, 0.5 + 0.5 * dir.y);
  fragColor = vec4(col * uBright, uOpacity);
}
`;

describe("BACKDROP_OPTIONS", () => {
  it("includes live, authored skies, and AI Dynamic outside the cycle pool", () => {
    expect(BACKDROP_OPTIONS.some((o) => o.value === "live")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "aurora")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "dynamic")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "custom")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "plugin")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "dusk")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "earth")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "meadow")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "tunnel")).toBe(true);
    expect(skyGroup("earth")).toBe("photo");
    expect(skyGroup("aurora")).toBe("nature");
    expect(skyGroup("matrix")).toBe("digital");
    expect(skyGroup("dynamic")).toBe("live");
    expect(skyGroup("none")).toBe("plain");
    expect(CYCLE_SKIES).not.toContain("custom");
    expect(CYCLE_SKIES).not.toContain("plugin");
    expect(CYCLE_SKIES).toContain("matrix");
    expect(CYCLE_SKIES).toContain("aurora");
    expect(CYCLE_SKIES).toContain("lattice");
    expect(CYCLE_SKIES).toContain("dusk");
    expect(CYCLE_SKIES).toContain("phosphor");
    expect(CYCLE_SKIES).toContain("earth");
    expect(CYCLE_SKIES).toContain("meadow");
    expect(CYCLE_SKIES).toContain("tunnel");
    expect(CYCLE_SKIES).not.toContain("dynamic");
    expect(CYCLE_SKIES).not.toContain("none");
    expect(RECIPE_EASE_MAX_S).toBeGreaterThan(2);
    const sky = new Backdrop();
    expect(sky.skyPalette().a).toEqual(expect.any(Array));
    expect(sky.skyPalette().a).toHaveLength(3);
    liveCam.setPolicy("off", false);
    expect(cycleSkyPool()).not.toContain("live");
    liveCam.setPolicy("auto", false);
  });
});

describe("plugin sky contract", () => {
  it("rejects includes and non-whitelisted uniforms", () => {
    expect(pluginShaderError(OK_FRAG)).toBeNull();
    expect(pluginShaderError("uniform float uMode;\nvoid main() {}")).toMatch(/uMode/);
    expect(pluginShaderError("uniform vec3 uMotif;\nvoid main() {}")).toMatch(/uMotif/);
    expect(pluginShaderError("#include \"x.glsl\"\nvoid main() {}")).toMatch(/include/);
    expect(pluginShaderError("float n = 1.0;")).toMatch(/main/);
    const wrapped = wrapPluginSky(OK_FRAG);
    expect("frag" in wrapped && wrapped.frag.includes("uniform float uTime")).toBe(true);
    expect("frag" in wrapped && wrapped.frag.includes("uniform vec4 zotoVizSlots[128]")).toBe(true);
    expect("frag" in wrapped && wrapped.frag.includes("binding")).toBe(false);
    expect(pluginShaderError("layout(std140, binding = 0) uniform ZotoVizData { vec4 zotoVizSlots[128]; };\nvoid main() {}"))
      .toMatch(/UBO|binding/);
  });

  it("swaps in a plugin program and falls back on compile failure", () => {
    const sky = new Backdrop();
    sky.setKind("space");
    expect(sky.pluginSkyId()).toBeNull();
    expect(sky.setPluginShader({ id: "aurora", source: "uniform float uMode;\nvoid main() {}" })).toMatch(/uMode/);
    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBeNull();

    expect(sky.setPluginShader({ id: "aurora", source: OK_FRAG })).toBeNull();
    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBe("aurora");

    sky.setKind("dynamic");
    expect(sky.pluginSkyId()).toBeNull();
    sky.setKind("space");
    expect(sky.pluginSkyId()).toBeNull();

    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBe("aurora");
    sky.setPluginShader(null);
    expect(sky.pluginSkyId()).toBeNull();
    expect(PLUGIN_SKY_FALLBACK).toBe("space");
  });

  it("rebuilds the GPU program when swapping one plugin sky for another", () => {
    const sky = new Backdrop();
    const a = "void main() { fragColor = vec4(uAccent, 1.0); }";
    const b = "void main() { fragColor = vec4(uBg * 0.4, 1.0); }";
    expect(sky.setPluginShader({ id: "one", source: a })).toBeNull();
    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBe("one");
    const first = sky.mesh.material instanceof Object
      ? (sky.mesh.material as { fragmentShader?: string }).fragmentShader
      : "";
    expect(sky.setPluginShader({ id: "two", source: b })).toBeNull();
    sky.setKind("plugin");
    expect(sky.pluginSkyId()).toBe("two");
    const second = (sky.mesh.material as { fragmentShader?: string }).fragmentShader;
    expect(second).not.toEqual(first);
    expect(second).toContain("uBg * 0.4");
    expect(first).toContain("uAccent, 1.0");
    expect(sky.skyMorphing()).toBe(true);
    sky.tick(10);
    for (let i = 1; i <= 8; i++) sky.tick(10 + i * 0.3);
    expect(sky.skyMorphing()).toBe(false);
    expect(sky.fadeMesh.visible).toBe(false);
  });

  it("crossfades when the backdrop kind changes", () => {
    const sky = new Backdrop();
    sky.setKind("space");
    sky.setLook(1, 1, 0);
    sky.tick(1);
    for (let i = 1; i <= 8; i++) sky.tick(1 + i * 0.3);
    expect(sky.skyMorphing()).toBe(false);
    sky.setKind("aurora");
    expect(sky.skyMorphing()).toBe(true);
    expect(sky.fadeMesh.visible).toBe(true);
    for (let i = 1; i <= 8; i++) sky.tick(4 + i * 0.3);
    expect(sky.skyMorphing()).toBe(false);
  });
});
