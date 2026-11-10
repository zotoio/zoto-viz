import * as THREE from "three";

/**
 * Bonsai host scenery: garden light by time of day, the slow turntable, per-pad leaf density and
 * autumn, and instanced blossoms and falling leaves. The bench/board/slab and the tree are the
 * pack's two GLBs on the host mesh lane (pinned at the origin); this scenery finds their named
 * nodes, turns the board group from viz slot 0, feeds slot 1 (pad presence, autumn) to the
 * foliage shader and instances the blossom-card and falling-leaf templates from slots 2..5.
 * Foliage COLOR_0 is data (r = baked AO, g = (pad + 0.5) / 16, b = leaf rank), decoded here.
 * HD image-based lighting comes from the pack's `role: environment` image (host-mesh-env.ts).
 * Nothing is allocated per frame.
 */

/** slot0 indices (plugins/src/bonsai/frontend/bonsai.ts BS_SLOT). */
const S_YAW = 8;
const S_WARMTH = 11;
const S_SUN = 12;
const S_LIGHT = 13;
const S_BLOSSOMS = 15;
const S_FALLING = 16;
const S_LOW_FPS = 19;
const S_BREEZE = 22;
const S_NIGHT = 25;
const PAD_SLOT = 1;
export const BONSAI_MAX_PADS = 16;
const BLOSSOM_SLOT0 = 2;
const BLOSSOMS_PER_SLOT = 16;
export const BONSAI_MAX_BLOSSOMS = 32;
const FALL_SLOT = 4;
const FALL_LOOK_SLOT = 5;
export const BONSAI_MAX_FALLING = 16;
/** Nodes that ride the turntable; the bench stays put. */
export const BONSAI_TURNTABLE = ["board", "rock", "moss", "contact-shadow", "trunk", "foliage"] as const;
/** Atlas offset from a green leaf tile to its autumn tile (build_bonsai.py LEAF_TILES). */
const AUTUMN_U = 0.5;

const BLOSSOM_TINTS: readonly [number, number, number][] = [
  [1.0, 0.78, 0.86], // pink
  [1.0, 0.9, 0.84], // blush
  [1.0, 1.0, 1.0], // white
  [0.84, 0.66, 0.92], // plum
];
const FALL_TINTS: readonly [number, number, number][] = [
  [1.0, 0.5, 0.42], // crimson
  [1.0, 0.74, 0.5], // orange
  [1.0, 1.0, 0.92], // gold
];

export type SlotReader = (slot: number, index: number) => number;

export type BonsaiScenery = {
  root: THREE.Group;
  update(read: SlotReader, dt: number): void;
  /** Bound to the lane's GLB nodes (tests). */
  readonly bound: boolean;
  readonly blossomCount: number;
  readonly fallingCount: number;
  readonly foliagePatched: boolean;
};

type Part = { mesh: THREE.InstancedMesh; rel: THREE.Matrix4 };

/** Rest matrices of the turntable nodes (userData would be JSON-copied by clone()). */
const REST = new WeakMap<THREE.Object3D, THREE.Matrix4>();

type FoliageUniforms = {
  uBsPresence: { value: Float32Array };
  uBsAutumn: { value: Float32Array };
  uBsTime: { value: number };
  uBsSway: { value: number };
};

/** Every mesh under `node`, with its matrix relative to `node` (gltfpack puts dequantisation there). */
function partsOf(node: THREE.Object3D, cap: number, name: string): Part[] {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const out: Part[] = [];
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mesh = new THREE.InstancedMesh(m.geometry, m.material, cap);
    mesh.name = `${name}-instances`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    out.push({ mesh, rel: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  return out;
}

const FOLIAGE_VERTEX_PARS = /* glsl */ `
uniform float uBsPresence[${BONSAI_MAX_PADS}];
uniform float uBsAutumn[${BONSAI_MAX_PADS}];
uniform float uBsTime;
uniform float uBsSway;
varying float vBsKeep;
varying float vBsAutumn;
`;

/** Decode the leaf's pad and rank from COLOR_0, then sway the pad and flutter the leaf a little. */
const FOLIAGE_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );
#ifdef USE_COLOR
  float bsPad = clamp( floor( color.g * 16.0 ), 0.0, ${BONSAI_MAX_PADS - 1}.0 );
  float bsRank = color.b;
  int bsI = int( bsPad );
  vBsKeep = uBsPresence[ bsI ] - bsRank;
  float bsStagger = fract( bsRank * 7.13 + 0.37 * bsPad );
  vBsAutumn = smoothstep( bsStagger * 0.9, bsStagger * 0.9 + 0.08, uBsAutumn[ bsI ] );
  float bsPhase = bsPad * 1.7;
  float bsLeaf = bsRank * 41.0;
  transformed += uBsSway * vec3(
    sin( uBsTime * 0.9 + bsPhase ) + 0.35 * sin( uBsTime * 2.3 + bsLeaf ),
    0.25 * sin( uBsTime * 1.7 + bsLeaf ),
    0.6 * cos( uBsTime * 0.7 + bsPhase ) + 0.35 * cos( uBsTime * 2.1 + bsLeaf )
  );
#else
  vBsKeep = 1.0;
  vBsAutumn = 0.0;
#endif
`;

const FOLIAGE_FRAGMENT_PARS = /* glsl */ `
varying float vBsKeep;
varying float vBsAutumn;
`;

/** Green leaf tile, or its autumn twin half an atlas to the right. */
const FOLIAGE_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 bsGreen = texture2D( map, vMapUv );
  vec4 bsAutumnTex = texture2D( map, vMapUv + vec2( ${AUTUMN_U.toFixed(2)}, 0.0 ) );
  diffuseColor *= mix( bsGreen, bsAutumnTex, vBsAutumn );
#endif
`;

/** COLOR_0.r is the baked AO; g and b are pad and rank data, never colour. */
const FOLIAGE_COLOR_FRAGMENT = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= vColor.r;
#endif
`;

/** Patch the shared foliage material once; returns its uniforms. */
export function patchFoliageMaterial(mat: THREE.Material): FoliageUniforms {
  const existing = mat.userData.bonsaiFoliage as FoliageUniforms | undefined;
  if (existing) return existing;
  const uniforms: FoliageUniforms = {
    uBsPresence: { value: new Float32Array(BONSAI_MAX_PADS).fill(1) },
    uBsAutumn: { value: new Float32Array(BONSAI_MAX_PADS) },
    uBsTime: { value: 0 },
    uBsSway: { value: 0 },
  };
  mat.userData.bonsaiFoliage = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBsPresence = uniforms.uBsPresence;
    shader.uniforms.uBsAutumn = uniforms.uBsAutumn;
    shader.uniforms.uBsTime = uniforms.uBsTime;
    shader.uniforms.uBsSway = uniforms.uBsSway;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${FOLIAGE_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", FOLIAGE_BEGIN_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FOLIAGE_FRAGMENT_PARS}`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  if ( vBsKeep < 0.0 ) discard;")
      .replace("#include <map_fragment>", FOLIAGE_MAP_FRAGMENT)
      .replace("#include <color_fragment>", FOLIAGE_COLOR_FRAGMENT)
      // the cards carry bent dome normals: light both faces as the dome's outside
      .replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("gl_FrontFacing ? 1.0 : - 1.0", "1.0"),
      );
  };
  mat.customProgramCacheKey = () => "bonsai-foliage-v1";
  mat.needsUpdate = true;
  return uniforms;
}

export function buildBonsaiScenery(): BonsaiScenery {
  const root = new THREE.Group();
  root.name = "bonsai-scenery";

  // garden light: the sun (warmth and height from slot 0), sky/ground fill, a cool rim, and a
  // low lantern that only shows at night
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3a3020, 0.7);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
  sun.target.position.set(0, 0.2, 0);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.35);
  fill.position.set(1.3, 0.7, 1.2);
  const rim = new THREE.DirectionalLight(0xe6f0ff, 0.35);
  rim.position.set(0.4, 1.6, -1.2);
  const lantern = new THREE.PointLight(0xffb070, 0, 3, 1.6);
  lantern.position.set(-0.9, 0.5, 0.15);
  root.add(hemi, sun, sun.target, fill, rim, lantern);

  const instances = new THREE.Group();
  instances.name = "bonsai-instances";
  root.add(instances);

  let anchorNode: THREE.Object3D | null = null;
  const turning: { node: THREE.Object3D; rest: THREE.Matrix4 }[] = [];
  let blossomParts: Part[] = [];
  let fallParts: Part[] = [];
  let foliage: FoliageUniforms | null = null;
  let swayScale = 1;
  let blossoms = 0;
  let falling = 0;
  let time = 0;

  const m4 = new THREE.Matrix4();
  const turn = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  /** Cards lie flat (normal +y); this stands them up to face the front camera, tilted to the sky. */
  const faceFront = new THREE.Quaternion().setFromAxisAngle(xAxis, (65 * Math.PI) / 180);
  const col = new THREE.Color();
  const warm = new THREE.Color(0xffc489);
  const noon = new THREE.Color(0xfff6ea);
  const moon = new THREE.Color(0x9fb4ff);

  const unbind = (): void => {
    for (const c of [...instances.children]) {
      instances.remove(c);
      (c as THREE.InstancedMesh).dispose();
    }
    blossomParts = [];
    fallParts = [];
    turning.length = 0;
    anchorNode = null;
    foliage = null;
  };

  const attached = (o: THREE.Object3D | null, lane: THREE.Object3D): boolean => {
    let p = o;
    while (p && p !== lane) p = p.parent;
    return p === lane;
  };

  let boundChildren = -1;
  /** Find the pinned GLB nodes. The two GLBs land one by one and the lane re-pins (new clones) on
   *  remount, so rebind whenever the lane's children change. */
  const bind = (): boolean => {
    const lane = root.parent;
    if (!lane) return false;
    if (anchorNode && attached(anchorNode, lane) && lane.children.length === boundChildren) return true;
    if (anchorNode) unbind();
    boundChildren = lane.children.length;
    const named = new Map<string, THREE.Object3D>();
    for (const child of lane.children) {
      if (child === root) continue;
      child.traverse((o) => { if (o.name && !named.has(o.name)) named.set(o.name, o); });
    }
    const leaves = named.get("foliage");
    const board = named.get("board");
    if (!leaves || !board) return false;
    for (const name of BONSAI_TURNTABLE) {
      const node = named.get(name);
      if (!node) continue;
      let rest = REST.get(node);
      if (!rest) {
        node.updateMatrix();
        rest = node.matrix.clone();
        REST.set(node, rest);
      }
      node.matrixAutoUpdate = false;
      turning.push({ node, rest });
    }
    lane.updateMatrixWorld(true);
    leaves.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || foliage) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat) return;
      foliage = patchFoliageMaterial(mat);
      // sway is written in the mesh's (dequantised) local units
      const s = mesh.matrixWorld.getMaxScaleOnAxis() / Math.max(1e-6, lane.matrixWorld.getMaxScaleOnAxis());
      swayScale = s > 1e-6 ? 1 / s : 1;
    });
    const bloom = named.get("blossom-card");
    if (bloom) { blossomParts = partsOf(bloom, BONSAI_MAX_BLOSSOMS, "blossom"); bloom.visible = false; }
    const leaf = named.get("falling-leaf");
    if (leaf) { fallParts = partsOf(leaf, BONSAI_MAX_FALLING, "falling-leaf"); leaf.visible = false; }
    for (const p of [...blossomParts, ...fallParts]) instances.add(p.mesh);
    anchorNode = board;
    return true;
  };

  const place = (part: Part, i: number, base: THREE.Matrix4): void => {
    tmp.multiplyMatrices(base, part.rel);
    part.mesh.setMatrixAt(i, tmp);
  };

  const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

  const update = (read: SlotReader, dt: number): void => {
    time += Math.max(0, Math.min(0.1, dt || 0));
    const yaw = read(0, S_YAW) || 0;
    turn.makeRotationY(yaw);
    const ok = bind();
    if (ok) {
      for (const t of turning) {
        t.node.matrix.multiplyMatrices(turn, t.rest);
        t.node.matrixWorldNeedsUpdate = true;
      }
      if (foliage) {
        const f = foliage as FoliageUniforms;
        const live = read(0, 0) >= 0.5;
        for (let k = 0; k < BONSAI_MAX_PADS; k++) {
          f.uBsPresence.value[k] = live ? read(PAD_SLOT, k * 2) : 1;
          f.uBsAutumn.value[k] = live ? read(PAD_SLOT, k * 2 + 1) : 0;
        }
        f.uBsTime.value = time;
        f.uBsSway.value = 0.0035 * clamp01(read(0, S_BREEZE)) * swayScale;
      }
    }

    // light: the sun climbs and warms through the day; night hands over to moon and lantern
    const warmth = clamp01(read(0, S_WARMTH));
    const elev = Math.max(-1, Math.min(1, read(0, S_SUN) || 0));
    const level = Math.max(0.2, Math.min(1.3, read(0, S_LIGHT) || 0.85));
    const night = clamp01(read(0, S_NIGHT));
    const h = Math.max(0.12, elev);
    sun.position.set(-1.1 * (1 - 0.4 * h), 0.3 + 1.6 * h, 1.0);
    col.copy(noon).lerp(warm, warmth).lerp(moon, night);
    sun.color.copy(col);
    sun.intensity = (0.6 + 1.5 * level) * (1 - 0.7 * night);
    hemi.intensity = 0.35 + 0.45 * level;
    hemi.color.setRGB(0.88 + 0.1 * warmth, 0.92, 1.0 - 0.15 * warmth).lerp(moon, night * 0.6);
    fill.intensity = 0.2 + 0.2 * level;
    rim.intensity = 0.2 + 0.2 * level * (1 - night);
    lantern.intensity = 0.8 * night;

    // blossoms: x, y, z, look = tint + size / 2 (board-local, turned with the board)
    const lowFps = read(0, S_LOW_FPS) === 1;
    const nb = Math.max(0, Math.min(BONSAI_MAX_BLOSSOMS, Math.round(read(0, S_BLOSSOMS) || 0)));
    const showB = lowFps ? Math.min(nb, 12) : nb;
    let ib = 0;
    for (let i = 0; i < showB && blossomParts.length; i++) {
      const slot = BLOSSOM_SLOT0 + Math.floor(i / BLOSSOMS_PER_SLOT);
      const o = (i % BLOSSOMS_PER_SLOT) * 4;
      const look = read(slot, o + 3);
      const tint = Math.floor(look);
      const size = (look - tint) * 2;
      if (!(size > 0.01)) continue;
      v3.set(read(slot, o), read(slot, o + 1), read(slot, o + 2)).applyMatrix4(turn);
      q.setFromAxisAngle(yAxis, i * 2.39996).premultiply(faceFront);
      m4.compose(v3, q, s3.setScalar(size));
      const c = BLOSSOM_TINTS[Math.max(0, Math.min(BLOSSOM_TINTS.length - 1, tint))]!;
      col.setRGB(c[0], c[1], c[2]);
      for (const p of blossomParts) { place(p, ib, m4); p.mesh.setColorAt(ib, col); }
      ib++;
    }
    blossoms = ib;
    for (const p of blossomParts) {
      p.mesh.count = ib;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }

    // falling leaves: x, y, z, angle + tint, size, tumble axis, landed
    const nf = Math.max(0, Math.min(BONSAI_MAX_FALLING, Math.round(read(0, S_FALLING) || 0)));
    let jf = 0;
    for (let i = 0; i < nf && fallParts.length; i++) {
      const o = i * 4;
      const size = read(FALL_LOOK_SLOT, o + 1);
      if (!(size > 0.01)) continue;
      const angle = read(FALL_SLOT, o + 3);
      v3.set(read(FALL_SLOT, o), read(FALL_SLOT, o + 1), read(FALL_SLOT, o + 2)).applyMatrix4(turn);
      if (read(FALL_LOOK_SLOT, o + 3) >= 0.5) {
        // resting on the slab: flat, turned with the board
        q.setFromAxisAngle(yAxis, yaw + angle);
      } else {
        const a = read(FALL_LOOK_SLOT, o + 2);
        axis.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
        q2.setFromAxisAngle(axis, angle);
        q.copy(faceFront).premultiply(q2);
      }
      m4.compose(v3, q, s3.setScalar(size));
      const tint = Math.round(read(FALL_LOOK_SLOT, o));
      const c = FALL_TINTS[Math.max(0, Math.min(FALL_TINTS.length - 1, tint))]!;
      col.setRGB(c[0], c[1], c[2]);
      for (const p of fallParts) { place(p, jf, m4); p.mesh.setColorAt(jf, col); }
      jf++;
    }
    falling = jf;
    for (const p of fallParts) {
      p.mesh.count = jf;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
    }
  };

  root.userData.onSlots = update;
  // instanced blossoms and leaves share the lane's template geometry and materials: detach them
  // so the lane's dispose walk frees those once, with the templates, not through this scenery
  root.userData.dispose = () => {
    unbind();
  };
  return {
    root,
    update,
    get bound() { return anchorNode !== null; },
    get blossomCount() { return blossoms; },
    get fallingCount() { return falling; },
    get foliagePatched() { return foliage !== null; },
  };
}
