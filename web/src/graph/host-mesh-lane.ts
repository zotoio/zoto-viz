import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinnedRoot } from "three/addons/utils/SkeletonUtils.js";
import {
  decodeHostMeshSlotPacket,
  HOST_MESH_FRAME_V1,
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

let meshoptReady: Promise<void> | null = null;

export function ensureHostMeshoptDecoder(loader: GLTFLoader): Promise<void> {
  if (!meshoptReady) {
    meshoptReady = MeshoptDecoder.ready.then(() => {
      loader.setMeshoptDecoder(MeshoptDecoder);
    });
  }
  return meshoptReady;
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

  constructor() {
    this.group.name = "HostMeshLane";
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
    const rows = await Promise.all(decls.map((d) => this.load(packId, d)));
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
    this.clearLive();
    for (const t of this.templates.values()) {
      t.template.removeFromParent();
      t.template.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
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
      }
    }
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
      tmp.fromArray(inst.matrix);
      root.matrix.copy(tmp);
      root.matrixAutoUpdate = false;
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
      tmp.fromArray(inst.matrix);
      root.matrix.copy(tmp);
      root.matrixAutoUpdate = false;
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
        s.mixer.stopAllAction();
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
    const url = this.assetUrl(packId, decl.path, decl.sha256);
    try {
      const gltf = await this.loader.loadAsync(url);
      const template = gltf.scene;
      template.visible = false;
      template.updateMatrixWorld(true);
      const meshCount = countSceneMeshes(template);
      if (meshCount === 0) {
        return this.storeTemplate(decl.id, { id: decl.id, kind: "rigid", template, swimClip: null, loadOk: false });
      }
      const skinned = hasSkinnedMesh(template);
      const swimClip = gltf.animations.find((a) => a.name === "swim") ?? gltf.animations[0] ?? null;
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

  private storeTemplate(id: string, row: LoadedTemplate): LoadedTemplate {
    this.templates.set(id, row);
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
