import { describe, expect, it, vi } from "vitest";
import {
  BACKDROP_OPTIONS, CYCLE_SKIES, cycleSkyPool, Backdrop, RECIPE_EASE_MAX_S,
  PLUGIN_SKY_FALLBACK, PHOTO_LOOP_S, PHOTO_LOOP_FADE_S, PHOTO_SKIES, isPhotoSky, isPhotoVideoUrl, photoSkyCandidates, photoLoopPhase, photoLoopMix, photoStillLoopSample, pluginShaderError, probePluginSkyCompile, wrapPluginSky, skyGroup,
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
    expect(BACKDROP_OPTIONS.some((o) => o.value === "bomb")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "reef")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "tornado")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "desert")).toBe(true);
    expect(BACKDROP_OPTIONS.some((o) => o.value === "amazon")).toBe(true);
    expect(skyGroup("earth")).toBe("photo");
    expect(skyGroup("bomb")).toBe("photo");
    expect(skyGroup("amazon")).toBe("photo");
    expect(isPhotoSky("reef")).toBe(true);
    expect(isPhotoSky("space")).toBe(false);
    expect(Object.keys(PHOTO_SKIES)).toEqual(expect.arrayContaining([
      "bomb", "reef", "tornado", "desert", "amazon", "aquarium", "macaws", "ruins", "fungi",
    ]));
    expect(isPhotoSky("fungi")).toBe(true);
    expect(PHOTO_LOOP_S).toBe(5);
    expect(photoLoopPhase(0)).toBe(0);
    expect(photoLoopPhase(5)).toBe(0);
    expect(photoLoopPhase(2.5)).toBeCloseTo(0.5);
    expect(photoLoopPhase(-1)).toBeCloseTo(0.8);
    expect(isPhotoVideoUrl("/skies/reef.webm")).toBe(true);
    expect(isPhotoVideoUrl("/skies/reef.mp4")).toBe(true);
    expect(isPhotoVideoUrl("/skies/reef.jpg")).toBe(false);
    expect(photoSkyCandidates("reef")).toEqual(["/skies/reef.webm", "/skies/reef.mp4", "/skies/reef.jpg"]);
    expect(PHOTO_LOOP_FADE_S).toBeCloseTo(0.35);
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
    expect(CYCLE_SKIES).toContain("bomb");
    expect(CYCLE_SKIES).toContain("reef");
    expect(CYCLE_SKIES).toContain("tornado");
    expect(CYCLE_SKIES).toContain("desert");
    expect(CYCLE_SKIES).toContain("amazon");
    expect(CYCLE_SKIES).toContain("aquarium");
    expect(CYCLE_SKIES).toContain("macaws");
    expect(CYCLE_SKIES).toContain("ruins");
    expect(CYCLE_SKIES).toContain("fungi");
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

  it("releases the compile-probe context", () => {
    const lose = vi.fn();
    const gl = {
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      createShader: () => ({}),
      shaderSource() {},
      compileShader() {},
      getShaderParameter: () => true,
      getShaderInfoLog: () => "",
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null),
    };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string) {
      if (type === "webgl2") return gl as never;
      return orig.call(this, type as never);
    } as typeof orig;
    try {
      expect(probePluginSkyCompile("void main() {}")).toBeNull();
      expect(lose).toHaveBeenCalledOnce();
    } finally {
      HTMLCanvasElement.prototype.getContext = orig;
    }
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

describe("photo sky loop seam", () => {
  it("crossfades the last window onto the start and is 0 again at wrap", () => {
    expect(photoLoopMix(0, 5)).toBe(0);
    expect(photoLoopMix(2.5, 5)).toBe(0);
    expect(photoLoopMix(5 - PHOTO_LOOP_FADE_S, 5)).toBe(0);
    expect(photoLoopMix(5 - PHOTO_LOOP_FADE_S / 2, 5)).toBeCloseTo(0.5);
    expect(photoLoopMix(5 - 1e-6, 5)).toBeCloseTo(1, 3);
    expect(photoLoopMix(5, 5)).toBe(0);
    expect(photoLoopMix(10, 5)).toBe(0);
    expect(photoLoopMix(1, 0.4)).toBe(0);
  });

  it("Ken Burns sample at t=0 matches t=period (closed loop)", () => {
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.8], [0.85, 0.15]] as const) {
      const a = photoStillLoopSample(u, v, 0);
      const b = photoStillLoopSample(u, v, PHOTO_LOOP_S);
      const c = photoStillLoopSample(u, v, PHOTO_LOOP_S * 2);
      expect(b.x).toBeCloseTo(a.x, 8);
      expect(b.y).toBeCloseTo(a.y, 8);
      expect(b.zoom).toBeCloseTo(a.zoom, 8);
      expect(b.breath).toBeCloseTo(a.breath, 8);
      expect(c.x).toBeCloseTo(a.x, 8);
    }
  });
});
