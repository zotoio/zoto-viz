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
    yaw: Math.atan2(matrix[2] || 0, matrix[0] || scale),
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
};

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

export function ensureHostMeshoptDecoder(loader: GLTFLoader): Promise<void> {
  if (!meshoptReady) {
    meshoptReady = MeshoptDecoder.ready.then(() => {
      loader.setMeshoptDecoder(MeshoptDecoder);
    });
  }
  return meshoptReady;
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

  constructor() {
    this.group.name = "HostMeshLane";
    this.loader.register((parser) => embeddedImageTexturePlugin(parser as EmbeddedImageParser));
  }

  setAssetOrder(ids: string[]): void {
    this.assetOrder = [...ids];
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
    for (const list of this.skinnedLive.values()) {
      for (const row of list) {
        row.mixer.time =
          row.animOffset + this.clockSec * (row.clipDuration > 0 ? 1 : 0);
        row.mixer.update(0);
        this.driftDecor(row.root, dtSec);
      }
    }
    for (const list of this.rigidLive.values()) {
      for (const row of list) this.driftDecor(row.root, dtSec);
    }
  }

  /** Gentle swim for host-pinned fish until a sandbox packet replaces them. */
  private driftDecor(root: THREE.Object3D, dt: number): void {
    const d = root.userData.aquDecor as AquariumDecorPose | undefined;
    if (!d) return;
    if (d.homeY === undefined) d.homeY = d.y;
    stepAquariumDecor(d, this.clockSec, dt);
    root.matrix.fromArray(hostMeshMatrixYawPos(d.x, d.y, d.z, d.yaw, d.scale));
    root.updateMatrixWorld(true);
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
      list.push({ root, mixer, animOffset, clipDuration });
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
      const kind = skinned && swimClip ? "skinned" : "rigid";
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

  /** Glass tank (or any non-GLB scenery) parented with the live instances. */
  setScenery(root: THREE.Object3D | null): void {
    this.disposeScenery();
    if (!root) return;
    this.scenery = root;
    this.group.add(root);
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
