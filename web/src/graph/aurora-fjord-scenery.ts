import * as THREE from "three";

/**
 * Aurora Fjord host scenery: night light, the still-water mirror, cabin windows, window streaks
 * and packet ripples on the water, and the fog bank. The terrain and shore are the pack's two
 * GLBs on the host mesh lane (pinned at the origin, water at y = 0); the aurora, stars and the
 * open water are the pack's sky shader. This scenery finds the GLB nodes by name, mirrors them
 * under the waterline (unlit copies tinted by moon and aurora), drives each cabin's window
 * emissive from viz slot 1 and instances ripples from slot 2. Every lane material gets the same
 * haze / fog-bank patch the sky uses, so land, reflections and open water fog together.
 * Nothing is allocated per frame.
 */

/** slot0 indices (plugins/src/aurora-fjord/frontend/fjord.ts AF_SLOT). */
export const AF_SLOT = {
  mark: 0,
  eyeX: 1,
  eyeZ: 3,
  strength: 9,
  storm: 12,
  fog: 13,
  failed: 14,
  lowFps: 19,
  ripples: 21,
  moon: 22,
  fogFront: 24,
  calm: 25,
  hazeR: 28,
  auroraR: 31,
  time: 34,
} as const;
export const AF_CABIN_SLOT = 1;
export const AF_CABIN_FLOATS = 8;
export const AF_MAX_CABINS = 8;
/** Per cabin in slot 1. */
export const AF_CABIN = { light: 0, flash: 1, warmth: 2, present: 3, shoreX: 4, shoreZ: 5 } as const;
export const AF_RIPPLE_SLOT = 2;
export const AF_MAX_RIPPLES = 16;
/** Named GLB nodes (build_fjord.py); windows are `cabin-window-<k>`, nearest cabin first. */
export const AF_NODES = ["terrain", "cabins", "pines", "boulders"] as const;
const WINDOW_PREFIX = "cabin-window-";

const WARM = new THREE.Color(1.0, 0.62, 0.3);
const COOL = new THREE.Color(1.0, 0.86, 0.66);

export type SlotReader = (slot: number, index: number) => number;

export type AuroraFjordScenery = {
  root: THREE.Group;
  update(read: SlotReader, dt: number): void;
  /** Bound to the lane's GLB nodes (tests). */
  readonly bound: boolean;
  readonly mirrorMeshes: number;
  readonly windows: number;
  readonly rippleCount: number;
  readonly streakCount: number;
};

type FjordUniforms = {
  uAfFog: { value: number };
  uAfFront: { value: number };
  uAfTime: { value: number };
  uAfHaze: { value: THREE.Color };
};

const VERTEX_PARS = /* glsl */ `
varying vec3 vAfWorld;
`;

const VERTEX_WORLD = /* glsl */ `
#include <project_vertex>
vAfWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uAfFog;
uniform float uAfFront;
uniform float uAfTime;
uniform vec3 uAfHaze;
uniform float uAfSide;
varying vec3 vAfWorld;
`;

/**
 * Detail maps tile every few tens of metres; across the fjord that repeat reads as a grid. Fade
 * the sample toward the map's own mean (its smallest mip) with distance.
 */
const FRAGMENT_MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float afDetail = smoothstep( 120.0, 900.0, length( vAfWorld - cameraPosition ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, textureLod( map, vMapUv, 12.0 ).rgb, 0.8 * afDetail );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/** Night vision has little colour: halve the albedo's saturation (emissive windows keep theirs). */
const FRAGMENT_ALBEDO = /* glsl */ `
#include <alphamap_fragment>
diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.5 );
`;

/** Originals keep what is above the water, reflections what is below it. */
const FRAGMENT_CLIP = /* glsl */ `
#include <clipping_planes_fragment>
if ( uAfSide * vAfWorld.y < -0.02 ) discard;
`;

/**
 * Distance haze plus the fog bank: thick and low beyond the front (it rolls in from the fjord
 * head as uAfFog rises), thinning with height. Mirrors the sky shader's fog so they meet.
 */
const FRAGMENT_FOG = /* glsl */ `
#include <fog_fragment>
{
  float afD = length( vAfWorld - cameraPosition );
  float afHaze = 1.0 - exp( -afD * ( 0.00022 + 0.0011 * uAfFog ) );
  float afRoll = 0.75 + 0.25 * sin( vAfWorld.x * 0.011 + vAfWorld.z * 0.004 + uAfTime * 0.05 );
  float afBank = uAfFog * afRoll * smoothstep( uAfFront + 220.0, uAfFront - 60.0, vAfWorld.z )
    * exp( -abs( vAfWorld.y ) / ( 30.0 + 70.0 * uAfFog ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uAfHaze, clamp( max( afHaze * 0.8, afBank ), 0.0, 0.96 ) );
}
`;

/** Patch one material (original side 1, reflection side -1). Shares the fog uniforms. */
export function patchFjordMaterial(mat: THREE.Material, shared: FjordUniforms, side: 1 | -1): void {
  if (mat.userData.auroraFjord) return;
  const uSide = { value: side };
  mat.userData.auroraFjord = { side };
  if ("fog" in mat) (mat as THREE.MeshStandardMaterial).fog = false;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAfFog = shared.uAfFog;
    shader.uniforms.uAfFront = shared.uAfFront;
    shader.uniforms.uAfTime = shared.uAfTime;
    shader.uniforms.uAfHaze = shared.uAfHaze;
    shader.uniforms.uAfSide = uSide;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <project_vertex>", VERTEX_WORLD);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <clipping_planes_fragment>", FRAGMENT_CLIP)
      .replace("#include <map_fragment>", FRAGMENT_MAP)
      .replace("#include <alphamap_fragment>", FRAGMENT_ALBEDO)
      .replace("#include <fog_fragment>", FRAGMENT_FOG);
  };
  mat.customProgramCacheKey = () => "aurora-fjord-v3";
  mat.needsUpdate = true;
}

/** Unlit reflection copy of a lane material: same maps and cut-out, tinted per frame. */
function mirrorMaterial(src: THREE.Material): THREE.MeshBasicMaterial {
  const s = src as THREE.MeshStandardMaterial;
  return new THREE.MeshBasicMaterial({
    map: s.map ?? null,
    vertexColors: s.vertexColors === true,
    alphaTest: s.alphaTest ?? 0,
    side: s.side,
    transparent: true,
    depthWrite: true,
  });
}

/** Soft ring (ripples) or soft vertical streak (window glints), white with alpha falloff. */
function glowTexture(kind: "ring" | "streak"): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n * 2 - 1;
      const v = (y + 0.5) / n * 2 - 1;
      let a: number;
      if (kind === "ring") {
        const r = Math.hypot(u, v);
        a = Math.exp(-((r - 0.82) ** 2) / 0.006) + 0.25 * Math.exp(-((r - 0.6) ** 2) / 0.004);
        a *= r < 1 ? 1 : 0;
      } else {
        const along = (v + 1) / 2;
        a = Math.exp(-(u * u) / 0.08) * Math.sin(Math.PI * along) * (0.55 + 0.45 * Math.cos(along * 31.4));
      }
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function glowMesh(kind: "ring" | "streak", cap: number, name: string): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(kind),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(0, 0, 0));
  return mesh;
}

export function buildAuroraFjordScenery(): AuroraFjordScenery {
  const root = new THREE.Group();
  root.name = "aurora-fjord-scenery";
  root.userData.ownLights = true;

  // night light: the moon behind the camera's left shoulder, a navy sky fill, and a green
  // (purple-fringed in a storm) wash from the aurora down the fjord
  const hemi = new THREE.HemisphereLight(0x2a3a5c, 0x07090c, 0.55);
  const moon = new THREE.DirectionalLight(0xb4c8ff, 0.55);
  moon.position.set(-400, 520, 380);
  moon.target.position.set(0, 0, -400);
  const aurora = new THREE.DirectionalLight(0x5dffa0, 0.4);
  aurora.position.set(-80, 420, -1600);
  aurora.target.position.set(0, 0, -200);
  root.add(hemi, moon, moon.target, aurora, aurora.target);

  const shared: FjordUniforms = {
    uAfFog: { value: 0 },
    uAfFront: { value: -1200 },
    uAfTime: { value: 0 },
    uAfHaze: { value: new THREE.Color(0.05, 0.07, 0.1) },
  };

  const mirror = new THREE.Group();
  mirror.name = "aurora-fjord-mirror";
  mirror.scale.set(1, -1, 1);
  root.add(mirror);
  const ripples = glowMesh("ring", AF_MAX_RIPPLES, "aurora-fjord-ripples");
  const streaks = glowMesh("streak", AF_MAX_CABINS, "aurora-fjord-streaks");
  root.add(ripples, streaks);

  let anchor: THREE.Object3D | null = null;
  let boundChildren = -1;
  const windows: (THREE.MeshStandardMaterial | null)[] = [];
  const windowMirrors: (THREE.MeshBasicMaterial | null)[] = [];
  const mirrorMats: THREE.MeshBasicMaterial[] = [];
  let mirrorMeshes = 0;
  let rippleCount = 0;
  let streakCount = 0;
  let time = 0;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const tint = new THREE.Color();
  const auroraCol = new THREE.Color();
  const camPos = new THREE.Vector3(8, 0, 40);
  const isWindowMirror = new Set<THREE.Material>();

  const unbind = (): void => {
    for (const c of [...mirror.children]) mirror.remove(c);
    for (const m of mirrorMats) m.dispose();
    mirrorMats.length = 0;
    windows.length = 0;
    windowMirrors.length = 0;
    isWindowMirror.clear();
    mirrorMeshes = 0;
    anchor = null;
  };

  const attached = (o: THREE.Object3D | null, lane: THREE.Object3D): boolean => {
    let p = o;
    while (p && p !== lane) p = p.parent;
    return p === lane;
  };

  /** Find the pinned GLB nodes and build the reflection. The GLBs land one by one and the lane
   *  re-pins (new clones) on remount, so rebind whenever the lane's children change. */
  const bind = (): boolean => {
    const lane = root.parent;
    if (!lane) return false;
    if (anchor && attached(anchor, lane) && lane.children.length === boundChildren) return true;
    if (anchor) unbind();
    boundChildren = lane.children.length;
    const named = new Map<string, THREE.Object3D>();
    const roots: THREE.Object3D[] = [];
    for (const child of lane.children) {
      if (child === root) continue;
      roots.push(child);
      child.traverse((o) => { if (o.name && !named.has(o.name)) named.set(o.name, o); });
    }
    const terrain = named.get("terrain");
    if (!terrain || !named.get("cabins")) return false;
    const mirrorOf = new Map<THREE.Material, THREE.MeshBasicMaterial>();
    for (const r of roots) {
      r.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) if (m) patchFjordMaterial(m, shared, 1);
      });
      const copy = r.clone(true);
      copy.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const swap = (m: THREE.Material): THREE.Material => {
          let mm = mirrorOf.get(m);
          if (!mm) {
            mm = mirrorMaterial(m);
            patchFjordMaterial(mm, shared, -1);
            mirrorOf.set(m, mm);
            mirrorMats.push(mm);
          }
          return mm;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        mirrorMeshes++;
      });
      mirror.add(copy);
    }
    for (let k = 0; k < AF_MAX_CABINS; k++) {
      const node = named.get(`${WINDOW_PREFIX}${k}`);
      let mat: THREE.MeshStandardMaterial | null = null;
      node?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !mat) mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      });
      windows.push(mat);
      const wm = mat ? mirrorOf.get(mat) ?? null : null;
      windowMirrors.push(wm);
      if (wm) isWindowMirror.add(wm);
    }
    anchor = terrain;
    return true;
  };

  const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

  const update = (read: SlotReader, dt: number): void => {
    time += Math.max(0, Math.min(0.1, dt || 0));
    const live = read(0, AF_SLOT.mark) >= 0.5;
    const strength = live ? clamp01(read(0, AF_SLOT.strength)) : 0.45;
    const storm = live ? clamp01(read(0, AF_SLOT.storm)) : 0;
    const fog = live ? clamp01(read(0, AF_SLOT.fog)) : 0;
    const moonLevel = live ? clamp01(read(0, AF_SLOT.moon)) : 0.6;
    const calm = live ? clamp01(read(0, AF_SLOT.calm)) : 1;

    // lights and the shared fog
    if (live) {
      auroraCol.setRGB(read(0, AF_SLOT.auroraR), read(0, AF_SLOT.auroraR + 1), read(0, AF_SLOT.auroraR + 2));
      shared.uAfHaze.value.setRGB(read(0, AF_SLOT.hazeR), read(0, AF_SLOT.hazeR + 1), read(0, AF_SLOT.hazeR + 2));
      shared.uAfFront.value = read(0, AF_SLOT.fogFront);
      shared.uAfTime.value = read(0, AF_SLOT.time);
    } else {
      auroraCol.setRGB(0.36, 1.0, 0.62);
      shared.uAfHaze.value.setRGB(0.05, 0.07, 0.1);
      shared.uAfFront.value = -1200;
      shared.uAfTime.value = time;
    }
    shared.uAfFog.value = fog;
    moon.intensity = 0.2 + 0.55 * moonLevel;
    hemi.intensity = 0.16 + 0.14 * moonLevel + 0.1 * strength;
    aurora.color.copy(auroraCol);
    aurora.intensity = (0.04 + 0.42 * strength) * (1 - 0.6 * fog);
    aurora.position.set(-80 + 200 * storm, 420 + 300 * storm, -1600 + 900 * storm);

    const ok = bind();
    if (!ok) {
      ripples.count = 0;
      streaks.count = 0;
      rippleCount = streakCount = 0;
      return;
    }

    // reflections: dim, cool, tinted by the sky over them; calm water reflects more
    tint.setRGB(0.024, 0.03, 0.046).multiplyScalar(0.6 + 0.5 * moonLevel)
      .add(col.copy(auroraCol).multiplyScalar(0.045 * strength));
    tint.multiplyScalar(0.55 + 0.45 * calm);
    for (const m of mirrorMats) if (!isWindowMirror.has(m)) m.color.copy(tint);

    // cabin windows: emissive from the talker's light, a brief lift on a packet
    for (let k = 0; k < AF_MAX_CABINS; k++) {
      const o = k * AF_CABIN_FLOATS;
      const present = live ? read(AF_CABIN_SLOT, o + AF_CABIN.present) >= 0.5 : k < 3;
      const light = live ? clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.light)) : present ? 0.6 : 0;
      const flash = live ? clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.flash)) : 0;
      const warmth = live ? clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.warmth)) : 0;
      const level = present ? Math.min(1.4, light + 0.4 * flash) : 0;
      col.copy(WARM).lerp(COOL, warmth);
      const w = windows[k];
      if (w) {
        w.emissive.copy(col);
        w.emissiveIntensity = 0.05 + 2.4 * level;
      }
      const wm = windowMirrors[k];
      if (wm) wm.color.copy(col).multiplyScalar(0.02 + 0.9 * level * (0.5 + 0.5 * calm));
    }

    // window streaks: a shimmer on the water from each lit cabin's shore toward the pack's eye
    if (live) camPos.set(read(0, AF_SLOT.eyeX), 0, read(0, AF_SLOT.eyeZ));
    let s = 0;
    for (let k = 0; k < AF_MAX_CABINS && live; k++) {
      const o = k * AF_CABIN_FLOATS;
      if (read(AF_CABIN_SLOT, o + AF_CABIN.present) < 0.5) continue;
      const level = clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.light)) + 0.4 * clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.flash));
      if (level < 0.03) continue;
      const sx = read(AF_CABIN_SLOT, o + AF_CABIN.shoreX);
      const sz = read(AF_CABIN_SLOT, o + AF_CABIN.shoreZ);
      let dx = camPos.x - sx;
      let dz = camPos.z - sz;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      const len = (25 + 70 * calm) * Math.min(1, 0.4 + level);
      pos.set(sx + dx * len * 0.5, 0.05, sz + dz * len * 0.5);
      q.setFromAxisAngle(yAxis, Math.atan2(dx, dz));
      m4.compose(pos, q, scl.set(2 + 2.5 * level, 1, len));
      streaks.setMatrixAt(s, m4);
      col.copy(WARM).lerp(COOL, clamp01(read(AF_CABIN_SLOT, o + AF_CABIN.warmth))).multiplyScalar(0.35 * Math.min(1, level));
      streaks.setColorAt(s, col);
      s++;
    }
    streaks.count = s;
    streakCount = s;
    streaks.instanceMatrix.needsUpdate = true;
    if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;

    // packet ripples: x, z, radius, look = round(hue * 255) + intensity
    const n = live ? Math.max(0, Math.min(AF_MAX_RIPPLES, Math.round(read(0, AF_SLOT.ripples) || 0))) : 0;
    const cap = live && read(0, AF_SLOT.lowFps) === 1 ? Math.min(n, 8) : n;
    let r = 0;
    for (let i = 0; i < cap; i++) {
      const o = i * 4;
      const radius = read(AF_RIPPLE_SLOT, o + 2);
      const look = read(AF_RIPPLE_SLOT, o + 3);
      const hue = Math.floor(look) / 255;
      const inten = look - Math.floor(look);
      if (!(radius > 0.05) || !(inten > 0.01)) continue;
      pos.set(read(AF_RIPPLE_SLOT, o), 0.06, read(AF_RIPPLE_SLOT, o + 1));
      m4.compose(pos, q.identity(), scl.set(radius * 2, 1, radius * 2));
      ripples.setMatrixAt(r, m4);
      col.setHSL(hue, 0.65, 0.6).multiplyScalar(inten * (1 - 0.5 * fog));
      ripples.setColorAt(r, col);
      r++;
    }
    ripples.count = r;
    rippleCount = r;
    ripples.instanceMatrix.needsUpdate = true;
    if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
  };

  root.userData.onSlots = update;
  // the reflection shares the lane's GLB geometry and textures: detach it so the lane's dispose
  // walk frees those once, with the templates; only the reflection materials are this scenery's
  root.userData.dispose = () => {
    unbind();
  };
  return {
    root,
    update,
    get bound() { return anchor !== null; },
    get mirrorMeshes() { return mirrorMeshes; },
    get windows() { return windows.filter(Boolean).length; },
    get rippleCount() { return rippleCount; },
    get streakCount() { return streakCount; },
  };
}