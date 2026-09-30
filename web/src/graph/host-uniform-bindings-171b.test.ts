/**
 * #171 (b) host findings (PA's uniform lint at 6ab6dbae, uniform-set-undeclared):
 *  - backdrop.ts: the built-in sky material set `uPhoto`, which only the agent sky's preamble
 *    (sky-agent.ts) declares. It is now bound only while a fragment that declares it is on the
 *    material, and the plate set through setPhoto follows it on and off.
 *  - scene.ts glowMaterial(): set `uResolution`, which neither GLOW_VERT nor GLOW_FRAG declares and
 *    nothing reads. Removed.
 *
 * Revert rows: put `uPhoto` back on the built-in sky (constructor, never dropped) -> the built-in
 * row goes red; never bind it for the agent sky -> the agent row goes red; put `uResolution` back
 * in glowMaterial() -> the glow row goes red.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { Backdrop, type BackdropKind } from "./backdrop";
import { NetScene } from "./scene";

/** Uniform names a GLSL program pair declares. */
function declared(mat: THREE.ShaderMaterial): Set<string> {
  const src = `${mat.vertexShader}\n${mat.fragmentShader}`;
  const out = new Set<string>();
  for (const m of src.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) out.add(m[1]!);
  return out;
}

/** Uniforms the material sets that its shaders never declare. */
function undeclared(mat: THREE.ShaderMaterial): string[] {
  const d = declared(mat);
  return Object.keys(mat.uniforms).filter((n) => !d.has(n)).sort();
}

type SkyInternals = { mat: THREE.ShaderMaterial };
const skyMat = (b: Backdrop) => (b as unknown as SkyInternals).mat;
const AGENT = "vec3 color(vec3 dir, float t) { return texture(uPhoto, dir.xy * 0.5 + 0.5).rgb * uAccent; }";

describe("#171 (b) backdrop: uPhoto is bound only where a fragment declares it", () => {
  it("built-in sky: no uPhoto on the material for any built-in kind, even after setPhoto", () => {
    const sky = new Backdrop();
    sky.setViewport(640, 360, 1);
    const plate = new THREE.Texture();
    for (const kind of ["dynamic", "aurora", "none"] as BackdropKind[]) {
      sky.setKind(kind);
      sky.setPhoto(plate);
      expect(skyMat(sky).uniforms.uPhoto, `${kind}: uPhoto set on the built-in sky`).toBeUndefined();
      expect(undeclared(skyMat(sky)), `${kind}: uniforms the built-in sky sets but never declares`).toEqual([]);
    }
  });

  it("agent sky: uPhoto is bound with the plate (set before or after the swap), and dropped on the way back", () => {
    const sky = new Backdrop();
    sky.setViewport(640, 360, 1);
    const plate = new THREE.Texture();
    sky.setPhoto(plate); // plate arrives before the agent sky is shown
    expect(sky.setCustom(AGENT)).toBeNull();
    sky.setKind("custom");
    expect(declared(skyMat(sky)).has("uPhoto"), "the agent preamble declares uPhoto").toBe(true);
    expect(skyMat(sky).uniforms.uPhoto?.value, "agent sky samples the plate").toBe(plate);
    const later = new THREE.Texture();
    sky.setPhoto(later); // scene.ts loads the plate async, after setCustom
    expect(skyMat(sky).uniforms.uPhoto?.value).toBe(later);
    sky.setKind("dynamic");
    expect(skyMat(sky).uniforms.uPhoto, "back on the built-in sky").toBeUndefined();
    sky.setKind("custom");
    expect(skyMat(sky).uniforms.uPhoto?.value, "the plate comes back with the agent sky").toBe(later);
    sky.setPhoto(null);
    expect(skyMat(sky).uniforms.uPhoto?.value, "cleared plate: the blank texture, still bound").toBeInstanceOf(THREE.Texture);
    expect(skyMat(sky).uniforms.uPhoto?.value).not.toBe(later);
  });
});

describe("#171 (b) scene: the edge glow material sets only uniforms its shaders declare", () => {
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("glowMaterial(): no uResolution, nothing undeclared", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(el);
    hosts.push(el);
    const graph = new NetScene(el);
    graph.setActive(false);
    const glow = (graph as unknown as { glowMat: THREE.ShaderMaterial }).glowMat;
    expect(glow.uniforms.uResolution, "dead uResolution binding").toBeUndefined();
    expect(undeclared(glow), "uniforms the glow material sets but never declares").toEqual([]);
    expect(Object.keys(glow.uniforms).sort()).toEqual(["uAdditive", "uAmt", "uMode", "uSpeed", "uTime"]);
  });
});
