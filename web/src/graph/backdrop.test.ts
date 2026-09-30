import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  BACKDROP_OPTIONS, CYCLE_SKIES, cycleSkyPool, Backdrop, RECIPE_EASE_MAX_S,
  PLUGIN_SKY_FALLBACK, PHOTO_LOOP_S, PHOTO_LOOP_MIN_S, PHOTO_LOOP_FADE_S, PHOTO_SKY_CROSSFADE_S, PHOTO_SKIES, clampPhotoLoopS, configurePhotoStillTexture, isPhotoSky, isPhotoVideoUrl, photoCacheRetainUrls, photoSkyCandidates, photoLoopPhase, photoLoopMix, photoStillLoopSample, photoVideoSeamFadeSec, pluginShaderError, prunePhotoTextureCache, prunePhotoVideoCache, probePluginSkyCompile, wrapPluginSky, skyGroup,
  type PhotoVideoLoop,
} from "./backdrop";
import { liveCam } from "../camera/livecam";
import { resetReducedMotionSubscriptionForTests } from "../core/motion";

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
      "alpine", "bamboo", "blossom", "fjord", "glacier", "lagoon", "lava", "lavender", "saltflat",
      "seastacks",
    ]));
    expect(isPhotoSky("fungi")).toBe(true);
    expect(PHOTO_LOOP_S).toBe(75);
    expect(clampPhotoLoopS(Number.NaN)).toBe(PHOTO_LOOP_S);
    expect(clampPhotoLoopS(1)).toBe(PHOTO_LOOP_MIN_S);
    expect(clampPhotoLoopS(900)).toBe(300);
    expect(photoLoopPhase(0)).toBe(0);
    expect(photoLoopPhase(PHOTO_LOOP_S)).toBe(0);
    expect(photoLoopPhase(PHOTO_LOOP_S / 2)).toBeCloseTo(0.5);
    expect(photoLoopPhase(-1, 10)).toBeCloseTo(0.9);
    expect(isPhotoVideoUrl("/skies/reef.webm")).toBe(true);
    expect(isPhotoVideoUrl("/skies/reef.mp4")).toBe(true);
    expect(isPhotoVideoUrl("/skies/reef.jpg")).toBe(false);
    expect(photoSkyCandidates("reef")).toEqual(["/skies/reef.webm", "/skies/reef.mp4", "/skies/reef.jpg"]);
    expect(PHOTO_LOOP_FADE_S).toBeCloseTo(0.35);
    expect(PHOTO_SKY_CROSSFADE_S).toBe(3);
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
    expect(pluginShaderError("void main() { float half = 0.5; }")).toMatch(/half/);
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
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
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

  it("plugin-sky-not-bound-outside-plugin-kind", () => {
    const sky = new Backdrop();
    sky.setKind("aurora");
    expect(sky.setPluginShader({ id: "demo", source: OK_FRAG }, () => null)).toBeNull();
    expect(sky.pluginSkyId()).toBeNull();
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
    expect(PLUGIN_SKY_FALLBACK).toBe("none");
    expect(sky.builtInSkyShown()).toBeNull();
  });

  it("does not paint another tile's plugin shader on a pane that has none", () => {
    const backrooms = new Backdrop();
    const aquarium = new Backdrop();
    expect(backrooms.setPluginShader({ id: "backrooms", source: OK_FRAG })).toBeNull();
    backrooms.setKind("plugin");
    aquarium.setKind("plugin");
    expect(backrooms.pluginSkyId()).toBe("backrooms");
    expect(aquarium.pluginSkyId()).toBeNull();
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

describe("photo sky cache", () => {
  it("retains only current and outgoing urls", () => {
    const retain = photoCacheRetainUrls("/skies/reef.jpg", "/skies/meadow.jpg");
    expect(retain.size).toBe(2);
    expect(retain.has("/skies/reef.jpg")).toBe(true);
    expect(retain.has("/skies/meadow.jpg")).toBe(true);
    expect(photoCacheRetainUrls("/a", null)).toEqual(new Set(["/a"]));
  });

  it("prunes extra still textures and disposes them", () => {
    const cache = new Map<string, THREE.Texture>();
    const a = new THREE.Texture();
    const b = new THREE.Texture();
    const c = new THREE.Texture();
    const disposeA = vi.spyOn(a, "dispose");
    const disposeC = vi.spyOn(c, "dispose");
    cache.set("/a", a);
    cache.set("/b", b);
    cache.set("/c", c);
    const removed = prunePhotoTextureCache(cache, photoCacheRetainUrls("/b", "/a"));
    expect(removed).toEqual(["/c"]);
    expect(cache.size).toBe(2);
    expect(disposeC).toHaveBeenCalledOnce();
    expect(disposeA).not.toHaveBeenCalled();
  });

  it("releases video decoders when pruning video cache entries", () => {
    const makeSlot = (url: string) => {
      const el = document.createElement("video");
      el.src = url;
      return { el, tex: new THREE.VideoTexture(el) };
    };
    const oldPack: PhotoVideoLoop = {
      url: "/skies/old.webm",
      active: 0,
      incoming: false,
      slots: [makeSlot("/skies/old.webm"), makeSlot("/skies/old.webm")],
    };
    const newPack: PhotoVideoLoop = {
      url: "/skies/new.webm",
      active: 0,
      incoming: false,
      slots: [makeSlot("/skies/new.webm"), makeSlot("/skies/new.webm")],
    };
    const cache = new Map([["/skies/old.webm", oldPack], ["/skies/new.webm", newPack]]);
    const removed = prunePhotoVideoCache(cache, photoCacheRetainUrls("/skies/new.webm", null));
    expect(removed).toEqual(["/skies/old.webm"]);
    expect(cache.size).toBe(1);
    expect(oldPack.slots[0].el.getAttribute("src")).toBeNull();
    expect(oldPack.slots[1].el.getAttribute("src")).toBeNull();
  });

  it("configures mipmaps on still photo textures", () => {
    const tex = new THREE.Texture();
    configurePhotoStillTexture(tex);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  });

  it("keeps outgoing still bound through the crossfade before cache prune", () => {
    const sky = new Backdrop();
    sky.setKind("reef");
    const cache = (sky as unknown as { photoCache: Map<string, THREE.Texture> }).photoCache;
    const outgoing = new THREE.Texture();
    outgoing.image = { width: 16, height: 9 };
    const incoming = new THREE.Texture();
    incoming.image = { width: 16, height: 9 };
    cache.set("/out.jpg", outgoing);
    cache.set("/in.jpg", incoming);
    const bindPhoto = (sky as unknown as { bindPhoto(t: THREE.Texture, animate: boolean, url?: string): void }).bindPhoto.bind(sky);
    const state = sky as unknown as { photoWant: string | null; photoOutgoingUrl: string | null };
    state.photoWant = "/out.jpg";
    bindPhoto(incoming, true, "/in.jpg");
    expect(cache.has("/out.jpg")).toBe(true);
    expect(cache.has("/in.jpg")).toBe(true);
    expect(state.photoOutgoingUrl).toBe("/out.jpg");
    expect(state.photoWant).toBe("/in.jpg");
  });

  it("crossfades outgoing (uVideo) into incoming (uVideoB) over PHOTO_SKY_CROSSFADE_S", () => {
    const sky = new Backdrop();
    (sky as unknown as { kind: string }).kind = "reef";
    const photoMat = (sky as unknown as { photoMat: THREE.ShaderMaterial }).photoMat;
    const internal = sky as unknown as { photoPlateMorphT: number; photoOutgoingUrl: string | null };
    const outgoing = new THREE.Texture();
    outgoing.image = { width: 16, height: 9 };
    const incoming = new THREE.Texture();
    incoming.image = { width: 16, height: 9 };
    const cache = (sky as unknown as { photoCache: Map<string, THREE.Texture> }).photoCache;
    cache.set("/out.jpg", outgoing);
    cache.set("/in.jpg", incoming);
    const bindPhoto = (sky as unknown as { bindPhoto(t: THREE.Texture, animate: boolean, url?: string): void }).bindPhoto.bind(sky);
    const state = sky as unknown as { photoWant: string | null };
    state.photoWant = "/out.jpg";
    bindPhoto(incoming, true, "/in.jpg");
    expect(photoMat.uniforms.uVideo.value).toBe(outgoing);
    expect(photoMat.uniforms.uVideoB.value).toBe(incoming);
    expect(photoMat.uniforms.uLoopMix.value).toBe(0);
    let t = 0;
    const step = 0.05;
    while (photoMat.uniforms.uLoopMix.value <= 0 && internal.photoPlateMorphT < 0.5) {
      t += step;
      sky.tick(t);
    }
    expect(photoMat.uniforms.uLoopMix.value).toBeGreaterThan(0);
    expect(photoMat.uniforms.uVideo.value).toBe(outgoing);
    expect(photoMat.uniforms.uVideoB.value).toBe(incoming);
    while (internal.photoPlateMorphT < 1) {
      t += step;
      sky.tick(t);
    }
    expect(internal.photoPlateMorphT).toBeCloseTo(1, 5);
    expect(t).toBeGreaterThanOrEqual(PHOTO_SKY_CROSSFADE_S - 0.11);
    expect(t).toBeLessThanOrEqual(PHOTO_SKY_CROSSFADE_S + 0.11);
    expect(photoMat.uniforms.uLoopMix.value).toBe(0);
    expect((sky as unknown as { photoWant: string | null }).photoWant).toBe("/in.jpg");
  });

  it("evicts outgoing photo after the crossfade window on tick", () => {
    const sky = new Backdrop();
    sky.setKind("reef");
    const cache = (sky as unknown as { photoCache: Map<string, THREE.Texture> }).photoCache;
    const outgoing = new THREE.Texture();
    const current = new THREE.Texture();
    const dispose = vi.spyOn(outgoing, "dispose");
    cache.set("/out.jpg", outgoing);
    cache.set("/in.jpg", current);
    const state = sky as unknown as {
      photoWant: string | null;
      photoOutgoingUrl: string | null;
      photoEvictAt: number;
      clock: number;
    };
    state.photoWant = "/in.jpg";
    state.photoOutgoingUrl = "/out.jpg";
    state.photoEvictAt = 0;
    state.clock = PHOTO_SKY_CROSSFADE_S;
    sky.tick(PHOTO_SKY_CROSSFADE_S);
    expect(cache.has("/out.jpg")).toBe(false);
    expect(cache.has("/in.jpg")).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("prunes unreferenced stills when bindPhoto runs", () => {
    const sky = new Backdrop();
    const cache = (sky as unknown as { photoCache: Map<string, THREE.Texture> }).photoCache;
    const stale = new THREE.Texture();
    const keep = new THREE.Texture();
    const incoming = new THREE.Texture();
    stale.image = keep.image = incoming.image = { width: 8, height: 8 };
    cache.set("/stale.jpg", stale);
    cache.set("/keep.jpg", keep);
    const bindPhoto = (sky as unknown as { bindPhoto(t: THREE.Texture, animate: boolean, url?: string): void }).bindPhoto.bind(sky);
    const state = sky as unknown as { photoWant: string | null };
    state.photoWant = "/keep.jpg";
    bindPhoto(incoming, true, "/new.jpg");
    expect(cache.has("/stale.jpg")).toBe(false);
    expect(cache.has("/keep.jpg")).toBe(true);
  });

  it("dispose removes the reduced-motion subscription", () => {
    resetReducedMotionSubscriptionForTests();
    const mqListeners: Array<() => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => { mqListeners.push(cb); },
      removeEventListener: (_: string, cb: () => void) => {
        const i = mqListeners.indexOf(cb);
        if (i >= 0) mqListeners.splice(i, 1);
      },
    };
    vi.stubGlobal("matchMedia", () => mq);
    const sky = new Backdrop();
    sky.dispose();
    expect(mqListeners.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("pauses and resumes photo video when prefers-reduced-motion toggles", () => {
    resetReducedMotionSubscriptionForTests();
    const mqListeners: Array<() => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => { mqListeners.push(cb); },
      removeEventListener: (_: string, cb: () => void) => {
        const i = mqListeners.indexOf(cb);
        if (i >= 0) mqListeners.splice(i, 1);
      },
    };
    vi.stubGlobal("matchMedia", () => mq);
    const sky = new Backdrop();
    const url = "/skies/loop.webm";
    const el = document.createElement("video");
    Object.defineProperty(el, "readyState", { configurable: true, value: 2 });
    const pauseSpy = vi.spyOn(el, "pause");
    const playSpy = vi.spyOn(el, "play").mockReturnValue(Promise.resolve());
    const pack = {
      url,
      active: 0,
      incoming: false,
      slots: [{ el, tex: new THREE.Texture() }, { el: document.createElement("video"), tex: new THREE.Texture() }],
    };
    const state = sky as unknown as {
      photoVideoCache: Map<string, typeof pack>;
      photoVideoUrl: string | null;
    };
    state.photoVideoCache.set(url, pack);
    state.photoVideoUrl = url;
    mq.matches = true;
    mqListeners.forEach((cb) => cb());
    expect(pauseSpy).toHaveBeenCalled();
    mq.matches = false;
    mqListeners.forEach((cb) => cb());
    expect(playSpy).toHaveBeenCalled();
    sky.dispose();
    vi.unstubAllGlobals();
  });

  it("Backdrop toggles Ken Burns with prefers-reduced-motion on, off, on", () => {
    resetReducedMotionSubscriptionForTests();
    const mqListeners: Array<() => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => { mqListeners.push(cb); },
      removeEventListener: (_: string, cb: () => void) => {
        const i = mqListeners.indexOf(cb);
        if (i >= 0) mqListeners.splice(i, 1);
      },
    };
    vi.stubGlobal("matchMedia", () => mq);
    const sky = new Backdrop();
    sky.setKind("reef");
    const photoMat = (sky as unknown as { photoMat: THREE.ShaderMaterial }).photoMat;
    const tex = new THREE.Texture();
    tex.image = { width: 16, height: 9 };
    const bindPhoto = (sky as unknown as { bindPhoto(t: THREE.Texture, animate: boolean, url?: string): void }).bindPhoto.bind(sky);
    bindPhoto(tex, true, "/skies/reef.jpg");
    expect(photoMat.uniforms.uAnimate.value).toBe(1);
    mq.matches = true;
    mqListeners.forEach((cb) => cb());
    expect(photoMat.uniforms.uAnimate.value).toBe(0);
    mq.matches = false;
    mqListeners.forEach((cb) => cb());
    expect(photoMat.uniforms.uAnimate.value).toBe(1);
    sky.dispose();
    vi.unstubAllGlobals();
  });
});

describe("photo sky loop seam", () => {
  it("caps seam fade for short sky clips so loops still wrap", () => {
    expect(photoVideoSeamFadeSec(5)).toBeCloseTo(0.35);
    expect(photoLoopMix(4.9, 5)).toBeGreaterThan(0);
    expect(photoLoopMix(0.2, 0.5, 0.1)).toBe(0);
  });

  it("crossfades the last window onto the start and is 0 again at wrap", () => {
    const dur = 12;
    expect(photoLoopMix(0, dur)).toBe(0);
    expect(photoLoopMix(dur / 2, dur)).toBe(0);
    const fade = photoVideoSeamFadeSec(dur);
    expect(photoLoopMix(dur - fade, dur, fade)).toBe(0);
    expect(photoLoopMix(dur - fade / 2, dur, fade)).toBeCloseTo(0.5);
    expect(photoLoopMix(dur - 1e-6, dur)).toBeCloseTo(1, 3);
    expect(photoLoopMix(dur, dur)).toBe(0);
    expect(photoLoopMix(dur * 2, dur)).toBe(0);
    expect(photoLoopMix(1, 0.4)).toBe(0);
  });

  it("photo cycle period is a uniform the sky can change", () => {
    const sky = new Backdrop();
    const photoMat = (sky as unknown as { photoMat: THREE.ShaderMaterial }).photoMat;
    expect(photoMat.fragmentShader).toContain("uPhotoPeriod");
    expect(photoMat.uniforms.uPhotoPeriod!.value).toBe(PHOTO_LOOP_S);
    sky.setPhotoPeriod(120);
    expect(photoMat.uniforms.uPhotoPeriod!.value).toBe(120);
    sky.setPhotoPeriod(1);
    expect(photoMat.uniforms.uPhotoPeriod!.value).toBe(PHOTO_LOOP_MIN_S);
    sky.dispose();
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
