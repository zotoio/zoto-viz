import { describe, expect, it } from "vitest";
import {
  BACKDROP_OPTIONS, CYCLE_SKIES, cycleSkyPool, Backdrop, RECIPE_EASE_MAX_S,
  PLUGIN_SKY_FALLBACK, pluginShaderError, wrapPluginSky,
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
    expect(CYCLE_SKIES).not.toContain("custom");
    expect(CYCLE_SKIES).not.toContain("plugin");
    expect(CYCLE_SKIES).toContain("matrix");
    expect(CYCLE_SKIES).toContain("aurora");
    expect(CYCLE_SKIES).toContain("lattice");
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
});
