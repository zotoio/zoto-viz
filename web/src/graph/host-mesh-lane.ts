import * as THREE from "three";
import { GLTFLoader, type GLTFLoaderPlugin } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinnedRoot } from "three/addons/utils/SkeletonUtils.js";
import {
  decodeHostMeshSlotPacket,
  HOST_MESH_FRAME_V1,
  hostMeshMatrixYawPos,
  type HostMeshInstanceExtras,
} from "../../../plugins/sdk/host-mesh-frame";

export type HostMeshAssetDecl = {
  id: string;
  path: string;
  sha256?: string;
};

export type HostMeshInstanceFrame = {
  assetId: string;
  matrices: Float32Array;
};

export const HOST_MESH_MAX_INSTANCES_DEFAULT = 48;

/** Dispose GPU resources on a template or loaded glTF root (returns dispose call count). */
export function disposeHostMeshObject3D(root: THREE.Object3D): number {
  let disposes = 0;
  const closedBitmaps = new Set<object>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry) {
        mesh.geometry.dispose();
        disposes += 1;
      }
      const mat = mesh.material;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const val = (m as unknown as Record<string, unknown>)[key];
          if (val && typeof val === "object" && (val as THREE.Texture).isTexture) {
            const tex = val as THREE.Texture;
            const image = tex.image as { close?: () => void } | null;
            if (image && typeof image.close === "function" && !closedBitmaps.has(image)) {
              closedBitmaps.add(image);
              image.close();
            }
            tex.dispose();
            disposes += 1;
          }
        }
        m.dispose();
        disposes += 1;
      }
    }
  });
  return disposes;
}

/** flags bit 0: host-pinned fish that drift until a sandbox packet (flags 0) replaces them. */
function tagAquariumDecor(
  root: THREE.Object3D,
  matrix: ArrayLike<number>,
  extras: HostMeshInstanceExtras,
): void {
  if ((extras.flags & 1) === 0) {
    delete root.userData.aquDecor;
    return;
  }
  const scale = matrix[5] || 1;
  const y = matrix[13] || 0;
  root.userData.aquDecor = {
    x: matrix[12] || 0,
    y,
    z: matrix[14] || 0,
    // Heading from the nose column (local +Z), the same yaw hostMeshMatrixYawPos was given.
    yaw: Math.atan2(matrix[8] || 0, matrix[10] || scale),
    scale,
    phase: extras.param1,
    speed: extras.param2 > 0 ? extras.param2 : 0.4,
    homeY: y,
  };
}

export type AquariumDecorPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  phase: number;
  speed: number;
  homeY: number;
};

/** Pinned fish cruise nose-first and arc at the glass instead of sliding tail-first. */
export function stepAquariumDecor(d: AquariumDecorPose, t: number, dt: number): void {
  if (dt <= 0 || !Number.isFinite(dt)) return;
  let yaw = d.yaw + Math.sin(t * 0.17 + d.phase) * 0.55 * dt;
  const fx0 = Math.sin(yaw);
  const fz0 = Math.cos(yaw);
  if (d.x > 0.9 && fx0 > 0) yaw += 2.2 * dt;
  if (d.x < -0.9 && fx0 < 0) yaw -= 2.2 * dt;
  if (d.z > 0.62 && fz0 > 0) yaw += 2.2 * dt;
  if (d.z < -0.72 && fz0 < 0) yaw -= 2.2 * dt;
  d.yaw = yaw;
  const spd = 0.16 + d.speed * 0.22;
  d.x = Math.max(-1.05, Math.min(1.05, d.x + Math.sin(yaw) * spd * dt));
  d.z = Math.max(-0.85, Math.min(0.75, d.z + Math.cos(yaw) * spd * dt));
  d.y = d.homeY + Math.sin(t * 0.65 + d.phase) * 0.04;
}

const WHEEL_NODE_NAMES = [
  "wheel_front_left",
  "wheel_front_right",
  "wheel_rear_left",
  "wheel_rear_right",
] as const;

type LoadedTemplate = {
  id: string;
  kind: "rigid" | "skinned";
  /** Hidden template root (all meshes). */
  template: THREE.Object3D;
  swimClip: THREE.AnimationClip | null;
  loadOk: boolean;
};

type LiveRigid = {
  root: THREE.Object3D;
};

type LiveSkinned = {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  animOffset: number;
  clipDuration: number;
  /** Aquarium HD only: bones the procedural fin beat and turn bend drive. */
  hd?: HdFishRig;
};

/**
 * How a lane animates fish beyond their baked swim clip. `aquarium-hd` (aquarium pack, HD model
 * set) adds a fin beat, a median-fin ripple, a spine bend into turns and a brighter tank lamp.
 * `standard` is the baked clip only, unchanged.
 */
export type HostMeshMotionProfile = "standard" | "aquarium-hd";

/** Rig bones of the designer fish: root → spine_01..03 → tail_01..02 run nose to tail; head carries the pectorals. */
const FISH_BEND_CHAIN = ["spine_01", "spine_02", "spine_03", "tail_01", "tail_02"] as const;
/** Share of the tail-side bend each chain bone takes (sums to 1; the tail end swings most). */
const FISH_BEND_WEIGHTS = [0.14, 0.2, 0.22, 0.24, 0.2] as const;
/** Spine bend (rad, whole body) per rad/s of yaw rate, and its clamp. */
export const FISH_BEND_PER_TURN = 0.3;
export const FISH_BEND_MAX = 0.62;

type HdFishRig = {
  chain: (THREE.Object3D | null)[];
  head: THREE.Object3D | null;
  finL: THREE.Object3D | null;
  finR: THREE.Object3D | null;
  phase: number;
  /** Yaw rate (rad/s) from the pack (param1) or the decor drift. */
  turnRate: number;
  /** Smoothed bend actually applied, rad. */
  bend: number;
};

/** Whole-body bend for a yaw rate: positive yaw rate (nose swinging toward +X) curls the tail toward +X too. */
export function fishTurnBend(turnRate: number): number {
  if (!Number.isFinite(turnRate)) return 0;
  return Math.max(-FISH_BEND_MAX, Math.min(FISH_BEND_MAX, turnRate * FISH_BEND_PER_TURN));
}

const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Rotate `bone` by `angle` about a world-space axis (applied on top of its current local pose). */
function rotateBoneWorldAxis(bone: THREE.Object3D, worldAxis: THREE.Vector3, angle: number): void {
  if (!angle || !bone.parent) return;
  bone.parent.getWorldQuaternion(_qp).invert();
  _ax.copy(worldAxis).applyQuaternion(_qp).normalize();
  _q.setFromAxisAngle(_ax, angle);
  bone.quaternion.premultiply(_q);
}

/**
 * Procedural motion layered over the baked swim clip for HD aquarium fish: the spine curls into
 * the turn (tail lags toward the inside, head leads), the caudal end beats harder, and the
 * pectorals row. Exported for tests.
 */
export function applyHdFishMotion(root: THREE.Object3D, rig: HdFishRig, t: number, dt: number): void {
  const target = fishTurnBend(rig.turnRate);
  rig.bend += (target - rig.bend) * Math.min(1, Math.max(0, dt) * 8);
  root.updateMatrixWorld(true);
  root.getWorldQuaternion(_qp);
  _up.set(0, 1, 0).applyQuaternion(_qp);
  _fwd.set(0, 0, 1).applyQuaternion(_qp);
  const up = _up.clone();
  const fwd = _fwd.clone();
  const beat = t * 9.5 + rig.phase;
  rig.chain.forEach((bone, i) => {
    if (!bone) return;
    // Tail-side bones turn the opposite way to the nose: with root mid-body that curls the
    // whole fish into a C toward the inside of the turn.
    const tailBeat = i >= 3 ? Math.sin(beat - i * 1.1) * (i === 3 ? 0.16 : 0.26) : Math.sin(beat - i * 1.1) * 0.04;
    rotateBoneWorldAxis(bone, up, -rig.bend * FISH_BEND_WEIGHTS[i]! + tailBeat);
  });
  if (rig.head) rotateBoneWorldAxis(rig.head, up, rig.bend * 0.22);
  const flap = Math.sin(t * 6.2 + rig.phase * 1.3);
  const row = Math.sin(t * 6.2 + rig.phase * 1.3 + 1.2);
  if (rig.finL) {
    rotateBoneWorldAxis(rig.finL, fwd, 0.42 * flap);
    rotateBoneWorldAxis(rig.finL, up, 0.3 * row);
  }
  if (rig.finR) {
    rotateBoneWorldAxis(rig.finR, fwd, -0.42 * flap);
    rotateBoneWorldAxis(rig.finR, up, -0.3 * row);
  }
}

function findHdFishRig(root: THREE.Object3D, phase: number, turnRate: number): HdFishRig | undefined {
  const chain = FISH_BEND_CHAIN.map((n) => root.getObjectByName(n) ?? null);
  if (!chain.some(Boolean)) return undefined;
  return {
    chain,
    head: root.getObjectByName("head") ?? null,
    finL: root.getObjectByName("fin_pectoral_L") ?? null,
    finR: root.getObjectByName("fin_pectoral_R") ?? null,
    phase,
    turnRate,
    bend: fishTurnBend(turnRate),
  };
}

/** Shared uniforms of the HD median-fin ripple shader. */
type FinRippleUniforms = { uFinTime: { value: number }; uFinAmp: { value: number } };

/**
 * Dorsal, anal and caudal fins have no bones; ripple them in the vertex shader before skinning.
 * Vertices far from the body's mid-height (fins) and toward the tail sway sideways in a
 * travelling wave. `box` is (midY, halfHeight, midZ, halfLength) of the bind-pose geometry.
 */
function patchFinRipple(mat: THREE.Material, shared: FinRippleUniforms, box: THREE.Vector4): void {
  if ((mat as { userData: Record<string, unknown> }).userData.zotoFinRipple) return;
  mat.userData.zotoFinRipple = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFinTime = shared.uFinTime;
    shader.uniforms.uFinAmp = shared.uFinAmp;
    shader.uniforms.uFinBox = { value: box };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uFinTime;\nuniform float uFinAmp;\nuniform vec4 uFinBox;",
      )
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "{",
          "  float hy = abs(transformed.y - uFinBox.x) / max(uFinBox.y, 1e-5);",
          "  float az = (transformed.z - uFinBox.z) / max(uFinBox.w, 1e-5);",
          "  float finW = smoothstep(0.55, 1.0, hy) + (1.0 - smoothstep(-1.0, -0.6, az)) * 0.7;",
          "  float wave = sin(uFinTime * 7.5 - az * 6.0);",
          "  transformed.x += uFinAmp * finW * uFinBox.w * 0.04 * wave;",
          "}",
        ].join("\n"),
      );
  };
  mat.customProgramCacheKey = () => "zoto-fin-ripple";
  mat.needsUpdate = true;
}

/** Brighter, cooler top lamp for the HD aquarium: the scanned PBR plants and gravel read darker than Standard. */
export function buildAquariumHdLights(): THREE.Group {
  const g = new THREE.Group();
  g.name = "AquariumHdLights";
  const hemi = new THREE.HemisphereLight(0xe8f6ff, 0x4a3c28, 0.9);
  const lamp = new THREE.DirectionalLight(0xfff3e2, 1.0);
  lamp.position.set(0.3, 3, 1.2);
  lamp.target.position.set(0, -0.6, 0);
  g.add(hemi, lamp, lamp.target);
  return g;
}

function stopSkinnedMixer(row: LiveSkinned): void {
  row.mixer.stopAllAction();
  row.mixer.uncacheRoot(row.root);
}

let meshoptReady: Promise<void> | null = null;

/** Shift each swim track so its first key is at t=0; preserve clip duration (ZotoDesigner 1/24 s lead-in). */
export function normalizeSwimClipStart(clip: THREE.AnimationClip | null): THREE.AnimationClip | null {
  if (!clip || clip.tracks.length === 0) return clip;
  const duration = clip.duration;
  const out = clip.clone();
  for (const track of out.tracks) {
    if (track.times.length === 0) continue;
    const t0 = track.times[0]!;
    if (t0 === 0) continue;
    for (let i = 0; i < track.times.length; i++) {
      track.times[i] = track.times[i]! - t0;
    }
  }
  out.duration = duration;
  return out;
}

/**
 * The decoder's wasm init is shared, but every loader needs its own setMeshoptDecoder call. Each
 * mosaic pane mounts its own HostMeshLane (and GLTFLoader); memoising the set call left every lane
 * after the first throwing "setMeshoptDecoder must be called before loading compressed files", so
 * aquarium fish, koi rocks and rocket cars never appeared.
 */
export function ensureHostMeshoptDecoder(loader: GLTFLoader): Promise<void> {
  if (!meshoptReady) meshoptReady = MeshoptDecoder.ready;
  return meshoptReady.then(() => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });
}

/**
 * glTF images live in the GLB buffer. Three's ImageBitmapLoader then `fetch()`es
 * a `blob:` URL, which this page's connect-src rejects, so every map is dropped
 * and the mesh renders as flat metal. Decode the buffer here instead.
 */
const GL_MAG_FILTER: Record<number, THREE.MagnificationTextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
};

const GL_MIN_FILTER: Record<number, THREE.MinificationTextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};

const GL_WRAP: Record<number, THREE.Wrapping> = {
  33071: THREE.ClampToEdgeWrapping,
  33648: THREE.MirroredRepeatWrapping,
  10497: THREE.RepeatWrapping,
};

type EmbeddedImageParser = {
  json: {
    textures?: { source?: number; sampler?: number; name?: string }[];
    images?: { name?: string; uri?: string; mimeType?: string; bufferView?: number }[];
    samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  };
  getDependency: (type: string, index: number) => Promise<ArrayBuffer>;
};

export function embeddedImageTexturePlugin(parser: EmbeddedImageParser): GLTFLoaderPlugin {
  return {
    name: "ZOTO_EMBEDDED_IMAGE",
    loadTexture(textureIndex) {
      const texDef = parser.json.textures?.[textureIndex];
      const source = texDef?.source === undefined ? undefined : parser.json.images?.[texDef.source];
      if (!source || source.bufferView === undefined || typeof createImageBitmap !== "function") return null;
      const bufferView = source.bufferView;
      const sampler = texDef?.sampler === undefined ? undefined : parser.json.samplers?.[texDef.sampler];
      return parser.getDependency("bufferView", bufferView).then(async (bytes) => {
        try {
          const blob = new Blob([bytes], source.mimeType ? { type: source.mimeType } : undefined);
          const bitmap = await createImageBitmap(blob, {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
          } as ImageBitmapOptions);
          const texture = new THREE.Texture(bitmap);
          texture.name = texDef?.name || source.name || "";
          texture.flipY = false;
          texture.magFilter = (sampler?.magFilter !== undefined && GL_MAG_FILTER[sampler.magFilter]) || THREE.LinearFilter;
          texture.minFilter = (sampler?.minFilter !== undefined && GL_MIN_FILTER[sampler.minFilter]) || THREE.LinearMipmapLinearFilter;
          texture.wrapS = (sampler?.wrapS !== undefined && GL_WRAP[sampler.wrapS]) || THREE.RepeatWrapping;
          texture.wrapT = (sampler?.wrapT !== undefined && GL_WRAP[sampler.wrapT]) || THREE.RepeatWrapping;
          texture.generateMipmaps = texture.minFilter !== THREE.NearestFilter && texture.minFilter !== THREE.LinearFilter;
          texture.needsUpdate = true;
          return texture;
        } catch (e) {
          console.warn("zoto-viz host mesh: embedded image", source.name || bufferView, e);
          throw e;
        }
      });
    },
  };
}

function countSceneMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n += 1;
  });
  return n;
}

function hasSkinnedMesh(root: THREE.Object3D): boolean {
  let skinned = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned;
}

/**
 * Plugin skies are transparent and fill the view, so they composite after the
 * opaque pass. Live meshes join that pass, after the sky (renderOrder -10).
 */
const HOST_MESH_RENDER_ORDER = 2;

export function showHostMeshInstance(root: THREE.Object3D): void {
  root.visible = true;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = HOST_MESH_RENDER_ORDER;
    mesh.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      m.transparent = true;
      m.depthTest = true;
      m.depthWrite = true;
    }
  });
}

function applyRigidArticulation(root: THREE.Object3D, extras: HostMeshInstanceExtras): void {
  const spin = extras.param1;
  for (const name of WHEEL_NODE_NAMES) {
    const w = root.getObjectByName(name);
    if (w) w.rotation.x = spin;
  }
  const flame = root.getObjectByName("booster_flame");
  if (flame) {
    const on = extras.param2 > 0.05;
    flame.visible = on;
    const s = on ? Math.min(1.5, extras.param2) : 0.001;
    flame.scale.set(s, s, s);
  }
}

export class HostMeshLane {
  readonly group = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<string, LoadedTemplate>();
  private readonly pending = new Map<string, Promise<LoadedTemplate | null>>();
  private readonly rigidLive = new Map<string, LiveRigid[]>();
  private readonly skinnedLive = new Map<string, LiveSkinned[]>();
  private assetOrder: string[] = [];
  maxInstancesPerAsset = HOST_MESH_MAX_INSTANCES_DEFAULT;
  private clockSec = 0;
  /** Bumped on {@link clear} so in-flight GLTF loads are discarded. */
  private loadEpoch = 0;
  /** Last slot packet per asset index, replayed when that GLB finishes loading. */
  private pendingByAsset = new Map<number, ArrayLike<number>>();
  private scenery: THREE.Object3D | null = null;
  private motion: HostMeshMotionProfile = "standard";
  private hdLights: THREE.Group | null = null;
  private readonly finUniforms: FinRippleUniforms = { uFinTime: { value: 0 }, uFinAmp: { value: 0 } };

  constructor() {
    this.group.name = "HostMeshLane";
    this.loader.register((parser) => embeddedImageTexturePlugin(parser as EmbeddedImageParser));
  }

  setAssetOrder(ids: string[]): void {
    this.assetOrder = [...ids];
  }

  /** Set before {@link ensureAssets}: the HD fin ripple is patched into materials at load. */
  setMotionProfile(profile: HostMeshMotionProfile): void {
    this.motion = profile;
    const hd = profile === "aquarium-hd";
    this.finUniforms.uFinAmp.value = hd ? 1 : 0;
    if (hd && !this.hdLights) {
      this.hdLights = buildAquariumHdLights();
      this.group.add(this.hdLights);
    } else if (!hd && this.hdLights) {
      this.hdLights.removeFromParent();
      this.hdLights = null;
    }
  }

  motionProfile(): HostMeshMotionProfile {
    return this.motion;
  }

  setMaxInstancesPerAsset(n: number): void {
    this.maxInstancesPerAsset = Math.max(1, Math.min(HOST_MESH_MAX_INSTANCES_DEFAULT, Math.floor(n)));
  }

  async ensureAssets(packId: string, decls: HostMeshAssetDecl[]): Promise<void> {
    this.setAssetOrder(decls.map((d) => d.id));
    await ensureHostMeshoptDecoder(this.loader);
    const rows = [];
    for (const decl of decls) rows.push(await this.load(packId, decl));
    const anyOk = rows.some((r) => r?.loadOk);
    if (!anyOk && decls.length > 0) {
      console.warn("zoto-viz host mesh: no assets loaded for", packId);
    }
  }

  allAssetsFailed(): boolean {
    if (this.templates.size === 0) return false;
    for (const t of this.templates.values()) {
      if (t.loadOk) return false;
    }
    return true;
  }

  clear(): void {
    this.loadEpoch += 1;
    this.pendingByAsset.clear();
    this.disposeScenery();
    this.clearLive();
    for (const t of this.templates.values()) {
      t.template.removeFromParent();
      disposeHostMeshObject3D(t.template);
    }
    this.templates.clear();
    this.pending.clear();
    this.assetOrder = [];
  }

  /** Advance skinned swim clips. */
  tick(dtSec: number): void {
    if (dtSec <= 0 || !Number.isFinite(dtSec)) return;
    this.clockSec += dtSec;
    this.finUniforms.uFinTime.value = this.clockSec;
    for (const list of this.skinnedLive.values()) {
      for (const row of list) {
        row.mixer.time =
          row.animOffset + this.clockSec * (row.clipDuration > 0 ? 1 : 0);
        row.mixer.update(0);
        const turn = this.driftDecor(row.root, dtSec);
        if (row.hd) {
          if (turn !== undefined) row.hd.turnRate = turn;
          applyHdFishMotion(row.root, row.hd, this.clockSec, dtSec);
        }
      }
    }
    for (const list of this.rigidLive.values()) {
      for (const row of list) this.driftDecor(row.root, dtSec);
    }
  }

  /** Gentle swim for host-pinned fish until a sandbox packet replaces them. */
  /** Returns the decor fish's yaw rate (rad/s), or undefined when `root` is not drifting decor. */
  private driftDecor(root: THREE.Object3D, dt: number): number | undefined {
    const d = root.userData.aquDecor as AquariumDecorPose | undefined;
    if (!d) return undefined;
    if (d.homeY === undefined) d.homeY = d.y;
    const yaw0 = d.yaw;
    stepAquariumDecor(d, this.clockSec, dt);
    root.matrix.fromArray(hostMeshMatrixYawPos(d.x, d.y, d.z, d.yaw, d.scale));
    root.updateMatrixWorld(true);
    return dt > 0 ? (d.yaw - yaw0) / dt : 0;
  }

  /**
   * Apply one sandbox host-mesh buffer slot (v2 packet or legacy 16-float matrix).
   */
  applySlotBuffer(data: ArrayLike<number>, slotAssetIndexOffset = 0): void {
    const pkt = decodeHostMeshSlotPacket(data);
    if (!pkt || pkt.instances.length === 0) return;
    const assetIndex =
      pkt.version === HOST_MESH_FRAME_V1 ? slotAssetIndexOffset : pkt.assetIndex;
    const assetId = this.assetOrder[assetIndex];
    if (!assetId) return;
    this.pendingByAsset.set(assetIndex, data);
    const tpl = this.templates.get(assetId);
    if (!tpl?.loadOk) return;
    if (tpl.kind === "skinned") {
      this.applySkinnedInstances(tpl, assetId, pkt.instances);
    } else {
      this.applyRigidInstances(tpl, assetId, pkt.instances);
    }
  }

  /** @deprecated Use applySlotBuffer — kept for tests. */
  applyInstances(frames: HostMeshInstanceFrame[]): void {
    for (const frame of frames) {
      const idx = this.assetOrder.indexOf(frame.assetId);
      if (idx < 0) continue;
      const n = Math.min(this.maxInstancesPerAsset, Math.floor(frame.matrices.length / 16));
      const instances = [];
      for (let i = 0; i < n; i++) {
        const matrix = new Float32Array(16);
        for (let j = 0; j < 16; j++) matrix[j] = frame.matrices[i * 16 + j]!;
        instances.push({ matrix, extras: { animTime: 0, param1: 0, param2: 0, flags: 0 } });
      }
      const buf: number[] = [2, idx, instances.length];
      for (const inst of instances) {
        buf.push(...inst.matrix, 0, 0, 0, 0);
      }
      this.applySlotBuffer(buf);
    }
  }

  private applyRigidInstances(
    tpl: LoadedTemplate,
    assetId: string,
    instances: { matrix: Float32Array; extras: HostMeshInstanceExtras }[],
  ): void {
    this.clearAssetLive(assetId);
    const list: LiveRigid[] = [];
    const cap = Math.min(this.maxInstancesPerAsset, instances.length);
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < cap; i++) {
      const inst = instances[i]!;
      const root = tpl.template.clone(true);
      showHostMeshInstance(root);
      tmp.fromArray(inst.matrix);
      root.matrix.copy(tmp);
      root.matrixAutoUpdate = false;
      tagAquariumDecor(root, inst.matrix, inst.extras);
      applyRigidArticulation(root, inst.extras);
      root.updateMatrixWorld(true);
      this.group.add(root);
      list.push({ root });
    }
    this.rigidLive.set(assetId, list);
  }

  private applySkinnedInstances(
    tpl: LoadedTemplate,
    assetId: string,
    instances: { matrix: Float32Array; extras: HostMeshInstanceExtras }[],
  ): void {
    this.clearAssetLive(assetId);
    if (!tpl.swimClip) return;
    const list: LiveSkinned[] = [];
    const cap = Math.min(this.maxInstancesPerAsset, instances.length);
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < cap; i++) {
      const inst = instances[i]!;
      const root = cloneSkinnedRoot(tpl.template) as THREE.Object3D;
      showHostMeshInstance(root);
      tmp.fromArray(inst.matrix);
      root.matrix.copy(tmp);
      root.matrixAutoUpdate = false;
      tagAquariumDecor(root, inst.matrix, inst.extras);
      root.updateMatrixWorld(true);
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(tpl.swimClip);
      action.play();
      const clipDuration = tpl.swimClip.duration > 0 ? tpl.swimClip.duration : 1;
      const animOffset = inst.extras.animTime % clipDuration;
      this.group.add(root);
      // Sandbox fish carry their yaw rate in param1; pinned decor (flags 1) uses param1 as a phase.
      const hd = this.motion === "aquarium-hd"
        ? findHdFishRig(root, inst.extras.animTime * 3.1 + i, (inst.extras.flags & 1) === 0 ? inst.extras.param1 : 0)
        : undefined;
      list.push({ root, mixer, animOffset, clipDuration, hd });
    }
    this.skinnedLive.set(assetId, list);
  }

  private clearAssetLive(assetId: string): void {
    const rigid = this.rigidLive.get(assetId);
    if (rigid) {
      for (const r of rigid) {
        r.root.removeFromParent();
      }
      this.rigidLive.delete(assetId);
    }
    const skin = this.skinnedLive.get(assetId);
    if (skin) {
      for (const s of skin) {
        stopSkinnedMixer(s);
        s.root.removeFromParent();
      }
      this.skinnedLive.delete(assetId);
    }
  }

  private clearLive(): void {
    for (const id of [...this.rigidLive.keys(), ...this.skinnedLive.keys()]) {
      this.clearAssetLive(id);
    }
  }

  private assetUrl(packId: string, path: string, sha256?: string): string {
    const rel = path.replace(/^\/+/, "").replace(/^assets\//i, "");
    const base = `/api/plugins/${encodeURIComponent(packId)}/asset/${rel.split("/").map(encodeURIComponent).join("/")}`;
    return sha256 ? `${base}?h=${encodeURIComponent(sha256)}` : base;
  }

  private async load(packId: string, decl: HostMeshAssetDecl): Promise<LoadedTemplate | null> {
    if (this.templates.has(decl.id)) return this.templates.get(decl.id)!;
    let pending = this.pending.get(decl.id);
    if (!pending) {
      pending = this.loadInner(packId, decl);
      this.pending.set(decl.id, pending);
    }
    return pending;
  }

  private async loadInner(packId: string, decl: HostMeshAssetDecl): Promise<LoadedTemplate | null> {
    const epoch = this.loadEpoch;
    const url = this.assetUrl(packId, decl.path, decl.sha256);
    try {
      const gltf = await this.loader.loadAsync(url);
      if (epoch !== this.loadEpoch) {
        disposeHostMeshObject3D(gltf.scene);
        return null;
      }
      const template = gltf.scene;
      template.visible = false;
      template.updateMatrixWorld(true);
      const meshCount = countSceneMeshes(template);
      if (meshCount === 0) {
        return this.storeTemplate(decl.id, { id: decl.id, kind: "rigid", template, swimClip: null, loadOk: false });
      }
      const skinned = hasSkinnedMesh(template);
      const rawSwim = gltf.animations.find((a) => a.name === "swim") ?? gltf.animations[0] ?? null;
      const swimClip = normalizeSwimClipStart(rawSwim);
      // A rigid model with a clip named "swim" animates its parts by node transforms (the HD
      // Blender koi wag their tails that way); it plays through the same cloned-mixer path.
      const nodeSwim = !skinned && rawSwim?.name === "swim";
      const kind = (skinned || nodeSwim) && swimClip ? "skinned" : "rigid";
      if (this.motion === "aquarium-hd" && skinned) this.patchHdFins(template);
      return this.storeTemplate(decl.id, {
        id: decl.id,
        kind,
        template,
        swimClip: kind === "skinned" ? swimClip : null,
        loadOk: true,
      });
    } catch (e) {
      console.warn("zoto-viz host mesh:", decl.id, e);
      const empty = new THREE.Group();
      return this.storeTemplate(decl.id, {
        id: decl.id,
        kind: "rigid",
        template: empty,
        swimClip: null,
        loadOk: false,
      });
    } finally {
      this.pending.delete(decl.id);
    }
  }

  private patchHdFins(template: THREE.Object3D): void {
    template.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (!bb) return;
      const box = new THREE.Vector4(
        (bb.min.y + bb.max.y) / 2,
        (bb.max.y - bb.min.y) / 2,
        (bb.min.z + bb.max.z) / 2,
        (bb.max.z - bb.min.z) / 2,
      );
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) patchFinRipple(m, this.finUniforms, box);
    });
  }

  /** Glass tank (or any non-GLB scenery) parented with the live instances. */
  setScenery(root: THREE.Object3D | null): void {
    this.disposeScenery();
    if (!root) return;
    this.scenery = root;
    this.group.add(root);
  }

  /**
   * Hand the scenery the pack's slot reader once a frame. Scenery that reacts to the pack
   * (the aquarium's eat puff) sets `userData.onSlots(read, dt)`.
   */
  updateScenery(read: (slot: number, index: number) => number, dt: number): void {
    const fn = this.scenery?.userData.onSlots as ((r: typeof read, d: number) => void) | undefined;
    fn?.(read, dt);
  }

  private disposeScenery(): void {
    const root = this.scenery;
    this.scenery = null;
    if (!root) return;
    root.removeFromParent();
    disposeHostMeshObject3D(root);
  }

  private storeTemplate(id: string, row: LoadedTemplate): LoadedTemplate {
    this.templates.set(id, row);
    if (row.loadOk) {
      const idx = this.assetOrder.indexOf(id);
      const pending = idx >= 0 ? this.pendingByAsset.get(idx) : undefined;
      if (pending) this.applySlotBuffer(pending);
    }
    return row;
  }
}

export function parseHostMeshInstances(
  assetId: string,
  data: ArrayLike<number>,
  maxInstances = HOST_MESH_MAX_INSTANCES_DEFAULT,
): HostMeshInstanceFrame | null {
  const pkt = decodeHostMeshSlotPacket(data, maxInstances);
  if (!pkt?.instances.length) return null;
  const n = pkt.instances.length;
  const matrices = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    matrices.set(pkt.instances[i]!.matrix, i * 16);
  }
  return { assetId, matrices };
}

export const HOST_MESH_MAX_FLOATS = HOST_MESH_MAX_INSTANCES_DEFAULT * 16;
