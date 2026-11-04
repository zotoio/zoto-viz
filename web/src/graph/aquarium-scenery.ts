import * as THREE from "three";

import { buildAquariumTank } from "./aquarium-tank";

/**
 * Aquarium host scenery. The pack's Blender GLB (plugins/src/aquarium/assets/aquarium-scape.glb)
 * is pinned once on the host mesh lane; this group finds its parts there and:
 * - shows the fresh (planted) or reef scape by slot0 water,
 * - turns each `fish-<name>` template into instanced meshes driven by viz slots 0, 1 and 3
 *   (position + yaw, species, fin phase, turn rate, size) with a travelling-wave swim bend and
 *   a turn bend in the vertex shader (no bones),
 * - adds caustics to everything lit from above and a slow sway to plants and fans,
 * - draws air-stone bubbles and the pack's packet bubbles / food flakes (slot2) as instances,
 * - keeps the glass tank and the eat puff (aquarium-tank.ts).
 * Nothing is allocated per frame once the GLB is found.
 */

export type SlotReader = (slot: number, index: number) => number;

/** slot0 / slot3 indices (plugins/src/aquarium/frontend/aquarium.ts AQU_SLOT / AQU_SLOT3). */
const S0_WATER = 0;
const S0_MURK = 5;
const S0_BUBBLES = 7;
const S0_FISH_COUNT = 17;
const S0_PARTICLES = 18;
const S0_SPECIES0 = 26;
const S0_VIGOR0 = 42;
const S3_HALF_W = 11;
const S3_PHASE0 = 16;
/** Width of one Blender scape module (the base tank length). */
export const SCAPE_MODULE_W = 2.44;
/** Side tiles each way: 5 modules cover the widest (3.4 half width) tank. */
const SCAPE_TILES = [-2, -1, 1, 2] as const;
const S3_TURN0 = 32;
const S3_GROW0 = 48;

export const AQUARIUM_MAX_FISH = 16;
const AIR_BUBBLES = 48;
const PACKET_PARTICLES = 24;

/** Species index → template, matching fish-behaviour FRESH_MESH / REEF_MESH. */
export const FRESH_TEMPLATES = ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta"] as const;
export const REEF_TEMPLATES = ["clown", "tang", "damsel", "goby", "yellowtang", "gramma"] as const;
const ALL_TEMPLATES = [...new Set<string>([...FRESH_TEMPLATES, ...REEF_TEMPLATES])];

export function fishTemplateName(species: number, reef: boolean): string {
  const t: readonly string[] = reef ? REEF_TEMPLATES : FRESH_TEMPLATES;
  return t[Math.max(0, Math.min(t.length - 1, Math.round(species)))] ?? "neon";
}

const FLOOR_Y = -0.805;

/** Shared shader uniforms (one object, so every patched material sees the same clock). */
type Shared = { uTime: { value: number }; uCaustic: { value: number } };

const CAUSTIC_GLSL = /* glsl */ `
uniform float uTime;
uniform float uCaustic;
varying vec3 vAqWorld;
varying vec3 vAqWorldN;
float aqWave(vec2 p, float t) {
  return sin(p.x * 1.7 + t) + sin(p.y * 2.3 - t * 0.8) + sin((p.x + p.y) * 1.1 + t * 1.3) + sin((p.x - p.y) * 2.9 - t * 0.6);
}
float aqCaustic(vec2 p, float t) {
  float a = 0.5 + 0.125 * aqWave(p * 6.0, t);
  float b = 0.5 + 0.125 * aqWave(p.yx * 9.0 + 3.1, -t * 1.2);
  return pow(1.0 - abs(a - 0.5) * 2.0, 8.0) + 0.6 * pow(1.0 - abs(b - 0.5) * 2.0, 10.0);
}
`;

function patchCaustic(mat: THREE.MeshStandardMaterial, shared: Shared, sway: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uCaustic = shared.uCaustic;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${CAUSTIC_GLSL}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float h = clamp((position.y - ${FLOOR_Y.toFixed(3)}) / 0.9, 0.0, 1.0);
          float s = ${sway.toFixed(3)} * h * h;
          transformed.x += sin(uTime * 0.9 + position.x * 3.0 + position.z * 2.0) * s;
          transformed.z += sin(uTime * 0.7 + position.x * 2.0 - position.z * 3.0) * s * 0.6;
        }`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vAqWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vAqWorldN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CAUSTIC_GLSL}`)
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          float up = clamp(vAqWorldN.y * 0.8 + 0.2, 0.0, 1.0);
          float depth = clamp((0.85 - vAqWorld.y) / 1.7, 0.0, 1.0);
          float c = aqCaustic(vAqWorld.xz + vAqWorld.y * 0.15, uTime * 0.9);
          totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * c * up * (1.0 - depth * 0.55) * uCaustic * diffuseColor.rgb;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `aq-caustic-${sway.toFixed(3)}`;
  mat.needsUpdate = true;
}

/**
 * Per-species skin, generated in the shader at run time (no texture files): body pattern over the
 * Blender vertex colours, lighter belly (countershading), a procedural scale normal, wetter roughness
 * on the flanks, view-angle sheen / iridescence, and translucent fins. Index = FISH_PATTERN key.
 */
export const FISH_PATTERN: Record<string, number> = {
  neon: 1, angel: 2, guppy: 3, cory: 4, discus: 5, cichlid: 6, betta: 7,
  clown: 8, tang: 9, damsel: 10, goby: 11, wrasse: 12, gramma: 13, yellowtang: 14,
};
/** Sheen strength (iridescent species shimmer, plain ones barely). */
export const FISH_SHEEN: Record<string, number> = {
  neon: 0.9, angel: 0.35, guppy: 0.6, cory: 0.15, discus: 0.45, cichlid: 0.4, betta: 1.0,
  clown: 0.2, tang: 0.35, damsel: 0.8, goby: 0.1, wrasse: 0.5, gramma: 0.3, yellowtang: 0.3,
};

const SKIN_GLSL = /* glsl */ `
varying vec3 vAqLoc;
varying vec3 vAqViewN;
uniform float uPat;
uniform float uSheen;
uniform float uHalfH;
float aqBand(float x, float c, float w) { return smoothstep(w, w * 0.55, abs(x - c)); }
float aqHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float aqSpots(vec2 p, float r) {
  vec2 i = floor(p), f = fract(p) - 0.5;
  vec2 o = vec2(aqHash(i), aqHash(i + 7.3)) - 0.5;
  return smoothstep(r, r * 0.6, length(f - o * 0.5));
}
vec4 aqPattern(float pat, float u, float v, float fin) {
  vec3 black = vec3(0.012, 0.012, 0.016), white = vec3(0.92, 0.92, 0.9);
  if (pat < 1.5) {
    float stripe = aqBand(v, 0.18, 0.16) * smoothstep(0.05, 0.12, u) * smoothstep(0.9, 0.7, u);
    float red = smoothstep(0.42, 0.5, u) * smoothstep(0.05, -0.15, v) * smoothstep(0.95, 0.8, u);
    if (stripe > 0.01) return vec4(vec3(0.05, 0.55, 1.0) * 1.15, stripe * (1.0 - fin));
    return vec4(vec3(0.75, 0.05, 0.04), red * (1.0 - fin));
  }
  if (pat < 2.5) {
    float b = max(max(aqBand(u, 0.12, 0.035), aqBand(u, 0.38, 0.05)), aqBand(u, 0.66, 0.04));
    return vec4(black + 0.05, b * 0.85);
  }
  if (pat < 3.5) {
    float s = aqSpots(vec2(u * 22.0, v * 8.0), 0.22) * smoothstep(0.55, 0.7, u);
    return vec4(vec3(0.1, 0.35, 0.9), s * 0.8);
  }
  if (pat < 4.5) {
    float s = aqSpots(vec2(u * 26.0, v * 10.0), 0.2);
    float mask = aqBand(u, 0.1, 0.03);
    return vec4(vec3(0.08, 0.07, 0.06), max(s * 0.7, mask * 0.6));
  }
  if (pat < 5.5) {
    float w = sin(v * 18.0 + sin(u * 9.0) * 1.6);
    return vec4(vec3(0.1, 0.6, 0.65), smoothstep(0.55, 0.85, w) * 0.75 * (1.0 - fin * 0.5));
  }
  if (pat < 6.5) {
    float w = 0.5 + 0.5 * sin(u * 34.0);
    return vec4(black + 0.1, smoothstep(0.65, 0.95, w) * 0.45 * smoothstep(0.08, 0.15, u));
  }
  if (pat < 7.5) {
    return vec4(vec3(0.35, 0.02, 0.12), fin * 0.25);
  }
  if (pat < 8.5) {
    float bands = max(max(aqBand(u, 0.16, 0.06), aqBand(u, 0.47, 0.07)), aqBand(u, 0.86, 0.035));
    float edge = max(max(aqBand(u, 0.16, 0.085), aqBand(u, 0.47, 0.095)), aqBand(u, 0.86, 0.06));
    if (fin > 0.5) return vec4(black, smoothstep(0.75, 0.95, abs(v)) * 0.9);
    if (bands > 0.5) return vec4(white, bands);
    return vec4(black, edge * 0.95);
  }
  if (pat < 9.5) {
    float mark = smoothstep(0.12, 0.06, abs(v - 0.25 + 0.4 * (u - 0.4) * (u - 0.4) * 3.0)) * smoothstep(0.15, 0.25, u) * smoothstep(0.88, 0.8, u);
    float tail = smoothstep(0.85, 0.9, u);
    if (tail > 0.01) return vec4(vec3(0.95, 0.8, 0.05), tail);
    return vec4(black, mark * 0.95);
  }
  if (pat < 10.5) {
    return vec4(vec3(0.3, 0.75, 1.0), aqSpots(vec2(u * 30.0, v * 12.0), 0.15) * 0.5);
  }
  if (pat < 11.5) {
    float s = aqSpots(vec2(u * 12.0, v * 5.0), 0.3);
    return vec4(vec3(0.25, 0.18, 0.1), s * 0.6);
  }
  if (pat < 12.5) {
    return vec4(vec3(0.05, 0.25, 0.6), aqBand(fract(v * 2.5 + 0.5), 0.5, 0.12) * 0.6);
  }
  if (pat < 13.5) {
    return vec4(vec3(0.98, 0.78, 0.05), smoothstep(0.42, 0.55, u));
  }
  // yellow tang: all yellow with the white scalpel spine just ahead of the tail
  return vec4(white, aqBand(u, 0.8, 0.02) * aqBand(v, -0.1, 0.12));
}
`;

/** Swim bend: tail-weighted travelling wave + a turn bend toward the yaw rate. Local nose is +Z. */
function patchSwim(mat: THREE.MeshStandardMaterial, nose: number, len: number, halfW: number, fin: boolean, pat = 0, sheen = 0.3, halfH = 0.05): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPat = { value: pat };
    shader.uniforms.uSheen = { value: sheen };
    shader.uniforms.uHalfH = { value: halfH };
    shader.uniforms.uNose = { value: nose };
    shader.uniforms.uLen = { value: len };
    shader.uniforms.uHalfW = { value: halfW };
    shader.uniforms.uFin = { value: fin ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uNose;
        uniform float uLen;
        uniform float uHalfW;
        uniform float uFin;
        attribute vec3 aSwim;
        ${SKIN_GLSL}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vAqLoc = position;
        {
          // body travelling wave: amplitude grows toward the tail, ~1 wavelength per body
          float t = clamp((uNose - position.z) / uLen, 0.0, 1.0);
          float w = 0.06 + 0.94 * t * t;
          float wave = sin(aSwim.x - t * 6.2832) * aSwim.y * uLen * w;
          float bend = aSwim.z * uLen * t * t;
          // pectoral fins (the only fin verts off the midline) flap, out of phase left / right
          float side = position.x;
          if (uFin > 0.5 && abs(side) > uHalfW * 0.5) {
            float outw = abs(side) - uHalfW * 0.5;
            transformed.y += sin(aSwim.x * 0.8 + sign(side) * 1.2) * outw * 0.9;
            transformed.x += sign(side) * cos(aSwim.x * 0.8) * outw * 0.25;
          }
          transformed.x += wave + bend;
        }`,
      )
      .replace("#include <defaultnormal_vertex>", "#include <defaultnormal_vertex>\n        vAqViewN = normalize(transformedNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNose;\nuniform float uLen;\nuniform float uFin;\n${SKIN_GLSL}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float aqU = clamp((uNose - vAqLoc.z) / uLen, 0.0, 1.0);
        float aqV = clamp(vAqLoc.y / max(1e-4, uHalfH), -1.5, 1.5);
        if (uPat > 0.5) {
          vec4 pc = aqPattern(uPat, aqU, aqV, uFin);
          diffuseColor.rgb = mix(diffuseColor.rgb, pc.rgb, clamp(pc.a, 0.0, 1.0));
        }
        if (uFin < 0.5 && uPat > 0.5) diffuseColor.rgb *= mix(1.35, 0.85, smoothstep(-0.9, 0.7, aqV));
        if (uFin > 0.5) diffuseColor.a *= mix(0.95, 0.55, smoothstep(0.2, 1.0, abs(aqV)));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        if (uPat > 0.5) roughnessFactor = clamp(roughnessFactor * (uFin > 0.5 ? 1.1 : mix(0.75, 1.15, smoothstep(-0.5, 0.8, aqV))), 0.05, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (uPat > 0.5) {
          float aqH = uFin < 0.5
            ? length(fract(vec2(aqU * 70.0, aqV * 9.0 + floor(aqU * 70.0) * 0.5)) - vec2(0.2, 0.5)) * (1.0 - smoothstep(0.85, 1.0, aqU))
            : abs(fract(aqV * 7.0) - 0.5) * 0.6;
          vec3 aqDx = dFdx(vViewPosition), aqDy = dFdy(vViewPosition);
          float aqHx = dFdx(aqH), aqHy = dFdy(aqH);
          vec3 aqR1 = cross(aqDy, normal), aqR2 = cross(normal, aqDx);
          float aqDet = dot(aqDx, aqR1);
          vec3 aqGrad = sign(aqDet) * (aqHx * aqR1 + aqHy * aqR2);
          normal = normalize(abs(aqDet) * normal - aqGrad * 0.012);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (uSheen > 0.0) {
          float fres = pow(1.0 - abs(dot(normalize(vAqViewN), vec3(0.0, 0.0, 1.0))), 2.0);
          vec3 irid = 0.5 + 0.5 * cos(6.2832 * (fres * 1.3 + aqU * 0.6 + vec3(0.0, 0.33, 0.67)));
          totalEmissiveRadiance += irid * fres * uSheen * 0.22 * (uFin > 0.5 ? 1.4 : 1.0);
        }`,
      );
  };
  mat.customProgramCacheKey = () => (fin ? "aq-skin-fin" : "aq-skin");
  mat.needsUpdate = true;
}

type FishSpecies = {
  name: string;
  meshes: THREE.InstancedMesh[];
  swim: THREE.InstancedBufferAttribute[];
  count: number;
};

export type AquariumScenery = {
  root: THREE.Group;
  update(read: SlotReader, dt: number): void;
  /** Instanced fish drawn after the last update (tests). */
  readonly fishDrawn: number;
  /** True once the pinned GLB's parts were found. */
  readonly ready: boolean;
};

export function buildAquariumScenery(): AquariumScenery {
  const root = new THREE.Group();
  root.name = "aquarium-scenery";
  const tank = buildAquariumTank();
  root.add(tank);

  // lights: cool overhead lamp, soft sky fill, warm low bounce off the sand
  const hemi = new THREE.HemisphereLight(0xd8f0ff, 0x5a4a32, 0.85);
  const lamp = new THREE.DirectionalLight(0xf2fbff, 1.9);
  lamp.position.set(0.3, 3.0, 0.6);
  lamp.target.position.set(0, -0.6, -0.2);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.45);
  rim.position.set(-2.0, 0.6, -2.0);
  root.add(hemi, lamp, lamp.target, rim);

  const shared: Shared = { uTime: { value: 0 }, uCaustic: { value: 1 } };

  // air-stone bubbles and packet particles
  const bubbleGeo = new THREE.SphereGeometry(1, 10, 6);
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8f8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45,
    clearcoat: 1, depthWrite: false, emissive: 0x204050, emissiveIntensity: 0.4,
  });
  const air = new THREE.InstancedMesh(bubbleGeo, bubbleMat, AIR_BUBBLES);
  const flakeGeo = new THREE.SphereGeometry(1, 6, 4);
  const flakeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const packets = new THREE.InstancedMesh(flakeGeo, flakeMat, PACKET_PARTICLES);
  for (const m of [air, packets]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
  }
  air.renderOrder = 5;
  root.add(air, packets);

  const species = new Map<string, FishSpecies>();
  // side glass clip planes for the scape (x >= -halfW and x <= halfW)
  const clipPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.22), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1.22)];
  const tiles: { group: THREE.Group; k: number; reef: boolean }[] = [];
  let halfW = 1.22;
  // local clipping must be on for the clip planes; the first tank pane switches it on
  const firstPane = tank.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
  if (firstPane) firstPane.onBeforeRender = (renderer) => { renderer.localClippingEnabled = true; };
  let lane: THREE.Object3D | null = null;
  let scapeFresh: THREE.Object3D[] = [];
  let scapeReef: THREE.Object3D[] = [];
  let anchor: THREE.Object3D | null = null;
  let ready = false;
  let drawn = 0;
  let time = 0;

  // per-fish motion smoothing (indexed by slot1 order; reset when the species there changes)
  const prevPhase = new Float32Array(AQUARIUM_MAX_FISH);
  const prevY = new Float32Array(AQUARIUM_MAX_FISH);
  const prevSp = new Float32Array(AQUARIUM_MAX_FISH).fill(-1);
  const ampSm = new Float32Array(AQUARIUM_MAX_FISH);
  const pitchSm = new Float32Array(AQUARIUM_MAX_FISH);
  const bankSm = new Float32Array(AQUARIUM_MAX_FISH);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const bubbleCol = new THREE.Color(0xdff6ff);
  const foodCol = new THREE.Color(0xb07a3a);
  const schedCol = new THREE.Color(0xd9a35a);

  const disposeSpecies = (): void => {
    for (const s of species.values()) for (const m of s.meshes) { m.removeFromParent(); m.dispose(); }
    species.clear();
  };

  /** Find the pinned scape under the lane (again after a remount) and build the instanced fish. */
  const findScape = (): void => {
    const parent = root.parent;
    if (!parent) return;
    if (ready && anchor) {
      let o: THREE.Object3D | null = anchor;
      while (o && o !== parent) o = o.parent;
      if (o === parent) return;
      ready = false;
      disposeSpecies();
    }
    lane = parent;
    const templates = new Map<string, THREE.Object3D>();
    const fresh: THREE.Object3D[] = [];
    const reef: THREE.Object3D[] = [];
    let sub: THREE.Object3D | null = null;
    lane.traverse((o) => {
      if (o === root || o.parent === root) return;
      const k = /^fish-([a-z]+)$/.exec(o.name);
      if (k && !templates.has(k[1]!)) templates.set(k[1]!, o);
      else if (o.name.startsWith("fresh-")) fresh.push(o);
      else if (o.name.startsWith("reef-")) reef.push(o);
      else if (o.name === "substrate") sub = o;
    });
    if (!sub || templates.size === 0) return;
    anchor = sub;
    scapeFresh = fresh;
    scapeReef = reef;
    // caustics on the scape; plants and fans sway
    const patched = new Set<THREE.Material>();
    const patch = (o: THREE.Object3D, sway: number): void => {
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        if (patched.has(src)) return;
        const m = src.clone();
        m.vertexColors = true;
        patchCaustic(m, shared, sway);
        m.clippingPlanes = clipPlanes;
        mesh.material = m;
        patched.add(m);
      });
    };
    patch(sub, 0);
    for (const o of [...fresh, ...reef]) {
      const sway = /plant-(vallisneria|rotala|fern)|coral-fan|anemone/.test(o.name) ? 0.035 : 0;
      patch(o, sway);
    }
    // Longer tanks: mirrored copies of the scape module either side (shared geometry and
    // materials, unscaled; a mirror is a reflection, not a stretch). The side glass clips them,
    // so decor is revealed smoothly as the tank grows instead of popping in.
    for (const t of tiles) { root.remove(t.group); }
    tiles.length = 0;
    for (const k of SCAPE_TILES) {
      for (const isReef of [false, true]) {
        const g = new THREE.Group();
        g.name = `aq-scape-tile-${isReef ? "reef" : "fresh"}-${k}`;
        g.position.x = k * SCAPE_MODULE_W;
        g.scale.x = k % 2 ? -1 : 1;
        for (const o of [sub, ...(isReef ? reef : fresh)]) {
          o.updateWorldMatrix(true, false);
          const c = o.clone(true);
          o.matrixWorld.decompose(c.position, c.quaternion, c.scale);
          c.visible = true;
          g.add(c);
        }
        g.visible = false;
        root.add(g);
        tiles.push({ group: g, k, reef: isReef });
      }
    }
    // fish templates → instanced meshes in this group (templates hidden in the lane)
    for (const name of ALL_TEMPLATES) {
      const t = templates.get(name);
      if (!t) continue;
      t.visible = false;
      t.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(t.matrixWorld).invert();
      const box = new THREE.Box3();
      const parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; fin: boolean }[] = [];
      t.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
        geo.computeBoundingBox();
        box.union(geo.boundingBox!);
        const src = mesh.material as THREE.MeshStandardMaterial;
        parts.push({ geo, mat: src.clone(), fin: /fin/.test(src.name) || /-fins$/.test(mesh.name) });
      });
      if (!parts.length) continue;
      const nose = box.max.z;
      const len = Math.max(1e-3, box.max.z - box.min.z);
      const s: FishSpecies = { name, meshes: [], swim: [], count: 0 };
      // body half width: the widest body vertex (fins sit on the midline except the pectorals)
      let halfW = 0;
      for (const p of parts) {
        if (p.fin) continue;
        const bb = p.geo.boundingBox!;
        halfW = Math.max(halfW, Math.abs(bb.min.x), Math.abs(bb.max.x));
      }
      let halfH = 0;
      for (const p of parts) {
        if (p.fin) continue;
        const bb = p.geo.boundingBox!;
        halfH = Math.max(halfH, Math.abs(bb.min.y), Math.abs(bb.max.y));
      }
      halfH = Math.max(1e-3, halfH);
      for (const p of parts) {
        // Plugin skies composite in the transparent pass with depthTest off, so anything left in the
        // opaque pass is painted over (it shows as a sky-coloured hole). Fish join the lane's
        // transparent pass after the sky, writing depth, like the lane's own meshes.
        p.mat.vertexColors = true;
        p.mat.opacity = 1;
        p.mat.transparent = true;
        p.mat.depthTest = true;
        p.mat.depthWrite = true;
        if (p.fin) {
          // fins: double-sided, depth-writing, alpha-to-coverage (no sort flicker), pushed back a hair
          p.mat.side = THREE.DoubleSide;
          p.mat.depthWrite = true;
          p.mat.alphaToCoverage = true;
          p.mat.opacity = 0.82;
          p.mat.polygonOffset = true;
          p.mat.polygonOffsetFactor = 1;
          p.mat.polygonOffsetUnits = 1;
        } else {
          p.mat.side = THREE.FrontSide;
        }
        const eye = /eye/.test(p.mat.name);
        if (eye) {
          // wet eye: glossy lens with a sharp specular highlight
          p.mat.roughness = 0.04;
          const ph = p.mat as THREE.MeshPhysicalMaterial;
          if (ph.isMeshPhysicalMaterial) { ph.clearcoat = 1; ph.clearcoatRoughness = 0.02; }
        }
        patchSwim(p.mat, nose, len, Math.max(1e-4, halfW), p.fin, eye ? 0 : FISH_PATTERN[name] ?? 0, eye ? 0 : FISH_SHEEN[name] ?? 0.3, halfH);
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(AQUARIUM_MAX_FISH * 3), 3);
        attr.setUsage(THREE.DynamicDrawUsage);
        p.geo.setAttribute("aSwim", attr);
        const im = new THREE.InstancedMesh(p.geo, p.mat, AQUARIUM_MAX_FISH);
        im.name = `aq-fish-${name}`;
        im.frustumCulled = false;
        // after the sky (-10) with the lane's meshes (2); fins after their body so the body's depth wins
        im.renderOrder = p.fin ? 3 : 2;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.count = 0;
        im.visible = false;
        root.add(im);
        s.meshes.push(im);
        s.swim.push(attr);
      }
      species.set(name, s);
    }
    ready = true;
  };

  const update = (read: SlotReader, dt: number): void => {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    time += step;
    shared.uTime.value = time;
    const murk = Math.max(0, Math.min(1, read(0, S0_MURK) || 0));
    shared.uCaustic.value = 0.9 * (1 - murk * 0.85);
    (tank.userData.onSlots as ((r: SlotReader, d: number) => void) | undefined)?.(read, step);
    findScape();
    const reef = read(0, S0_WATER) > 0.5;
    // pane-sized tank: the pack eases the glass half width; the tank and clip planes follow
    const hwRaw = read(3, S3_HALF_W);
    halfW = hwRaw > 0.3 && hwRaw < 5 ? hwRaw : 1.22;
    (tank.userData.setHalfW as ((hw: number) => void) | undefined)?.(halfW);
    (tank.userData.setWater as ((r: boolean) => void) | undefined)?.(reef);
    hemi.color.setHex(reef ? 0xd2ecff : 0xe6efcc);
    lamp.color.setHex(reef ? 0xeef8ff : 0xfff4dc);
    clipPlanes[0]!.constant = halfW;
    clipPlanes[1]!.constant = halfW;

    if (ready) {
      for (const o of scapeFresh) o.visible = !reef;
      for (const o of scapeReef) o.visible = reef;
      for (const t of tiles) t.group.visible = t.reef === reef && Math.abs(t.k) * SCAPE_MODULE_W - SCAPE_MODULE_W / 2 < halfW;
      for (const s of species.values()) s.count = 0;
      const n = Math.max(0, Math.min(AQUARIUM_MAX_FISH, Math.round(read(0, S0_FISH_COUNT) || 0)));
      drawn = 0;
      for (let i = 0; i < n; i++) {
        const s = species.get(fishTemplateName(read(0, S0_SPECIES0 + i), reef));
        if (!s) continue;
        const x = read(1, i * 4), y = read(1, i * 4 + 1), z = read(1, i * 4 + 2), yaw = read(1, i * 4 + 3);
        const growRaw = read(3, S3_GROW0 + i);
        const grow = growRaw > 0.01 ? Math.min(1, growRaw) : 1;
        const vigor = Math.max(0, Math.min(1, read(0, S0_VIGOR0 + i) || 0.5));
        const turn = Math.max(-4, Math.min(4, read(3, S3_TURN0 + i) || 0));
        const phase = read(3, S3_PHASE0 + i) || time * (5 + vigor * 4) + i;
        const sp = read(0, S0_SPECIES0 + i);
        const fresh = prevSp[i] !== sp || step <= 0;
        // tail-beat amplitude follows the beat rate (thrust): bursts beat hard, glides coast
        const rate = fresh ? 3 : Math.max(0, (phase - prevPhase[i]!) / step);
        const vy = fresh ? 0 : (y - prevY[i]!) / step;
        const k = fresh ? 1 : Math.min(1, step * 4);
        ampSm[i] = ampSm[i]! + (Math.min(0.11, 0.015 + rate * 0.012 * (0.8 + vigor * 0.4)) - ampSm[i]!) * k;
        // orientation from the smoothed velocity: pitch from climb, bank into the turn
        pitchSm[i] = pitchSm[i]! + (Math.max(-0.5, Math.min(0.5, -vy * 2.2)) - pitchSm[i]!) * k;
        bankSm[i] = bankSm[i]! + (Math.max(-0.45, Math.min(0.45, -turn * 0.16)) - bankSm[i]!) * k;
        prevPhase[i] = phase; prevY[i] = y; prevSp[i] = sp;
        pos.set(x, y, z);
        euler.set(pitchSm[i]!, yaw, bankSm[i]!, "YXZ");
        q.setFromEuler(euler);
        scl.setScalar(grow);
        m4.compose(pos, q, scl);
        const slotK = s.count++;
        for (let p = 0; p < s.meshes.length; p++) {
          s.meshes[p]!.setMatrixAt(slotK, m4);
          s.swim[p]!.setXYZ(slotK, phase, ampSm[i]!, -turn * 0.05);
        }
        drawn++;
      }
      for (const s of species.values()) {
        for (let p = 0; p < s.meshes.length; p++) {
          const m = s.meshes[p]!;
          m.count = s.count;
          m.visible = s.count > 0;
          if (s.count > 0) {
            m.instanceMatrix.needsUpdate = true;
            s.swim[p]!.needsUpdate = true;
          }
        }
      }
    }

    // air-stone bubbles: two stones at the back corners, deterministic in time
    const bubblesOn = read(0, S0_BUBBLES) > 0.5;
    air.count = bubblesOn ? AIR_BUBBLES : 0;
    if (bubblesOn) {
      for (let i = 0; i < AIR_BUBBLES; i++) {
        const stone = i & 1;
        const period = 3.4 + (i % 5) * 0.25;
        const age = (time + i * 0.613) % period / period;
        const sx = stone ? 0.98 : -0.98;
        const sz = stone ? -0.78 : -0.72;
        const wob = Math.sin(time * 3.1 + i * 1.7) * 0.012 + Math.sin(i * 2.3) * 0.02 * age;
        pos.set(sx + wob, FLOOR_Y + 0.06 + age * 1.55, sz + Math.cos(time * 2.7 + i) * 0.01);
        scl.setScalar(0.004 + (i % 4) * 0.0018 + age * 0.004);
        m4.compose(pos, q.identity(), scl);
        air.setMatrixAt(i, m4);
      }
      air.instanceMatrix.needsUpdate = true;
    }

    // the pack's particles: bubbles (kind < 1) and food flakes, in slot2 (x, y, z, kind)
    const pc = Math.max(0, Math.min(PACKET_PARTICLES, Math.min(15, Math.round(read(0, S0_PARTICLES) || 0))));
    for (let i = 0; i < pc; i++) {
      const kind = read(2, i * 4 + 3);
      pos.set(read(2, i * 4), read(2, i * 4 + 1), read(2, i * 4 + 2));
      scl.setScalar(kind < 1 ? 0.007 : 0.006);
      if (kind >= 1) scl.y *= 0.35;
      m4.compose(pos, q.identity(), scl);
      packets.setMatrixAt(i, m4);
      col.copy(kind < 1 ? bubbleCol : kind >= 1.5 ? schedCol : foodCol);
      packets.setColorAt(i, col);
    }
    packets.count = pc;
    if (pc > 0) {
      packets.instanceMatrix.needsUpdate = true;
      if (packets.instanceColor) packets.instanceColor.needsUpdate = true;
    }
  };

  root.userData.onSlots = update;
  root.userData.dispose = () => {
    disposeSpecies();
    bubbleGeo.dispose(); bubbleMat.dispose(); flakeGeo.dispose(); flakeMat.dispose();
    air.dispose(); packets.dispose();
  };
  return {
    root,
    update,
    get fishDrawn() { return drawn; },
    get ready() { return ready; },
  };
}
