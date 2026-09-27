import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type HostMeshAssetDecl = {
  id: string;
  path: string;
  sha256?: string;
};

export type HostMeshInstanceFrame = {
  assetId: string;
  /** column-major 4×4 per instance (16 floats). */
  matrices: Float32Array;
};

const MAX_INSTANCES = 48;
const MAX_FLOATS = MAX_INSTANCES * 16;

type LoadedAsset = {
  id: string;
  root: THREE.Object3D;
  mesh: THREE.Mesh;
  instanced: THREE.InstancedMesh;
};

export class HostMeshLane {
  readonly group = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly assets = new Map<string, LoadedAsset>();
  private readonly pending = new Map<string, Promise<LoadedAsset | null>>();

  async ensureAssets(packId: string, decls: HostMeshAssetDecl[]): Promise<void> {
    await Promise.all(decls.map((d) => this.load(packId, d)));
  }

  clear(): void {
    for (const a of this.assets.values()) {
      this.group.remove(a.instanced);
      a.mesh.geometry.dispose();
      if (Array.isArray(a.mesh.material)) a.mesh.material.forEach((m) => m.dispose());
      else a.mesh.material.dispose();
    }
    this.assets.clear();
    this.pending.clear();
  }

  applyInstances(frames: HostMeshInstanceFrame[]): void {
    for (const frame of frames) {
      const asset = this.assets.get(frame.assetId);
      if (!asset) continue;
      const n = Math.min(MAX_INSTANCES, Math.floor(frame.matrices.length / 16));
      const tmp = new THREE.Matrix4();
      asset.instanced.count = n;
      for (let i = 0; i < n; i++) {
        tmp.fromArray(frame.matrices, i * 16);
        asset.instanced.setMatrixAt(i, tmp);
      }
      asset.instanced.instanceMatrix.needsUpdate = true;
    }
  }

  private assetUrl(packId: string, path: string, sha256?: string): string {
    const base = `/api/plugins/${encodeURIComponent(packId)}/asset/${path.split("/").map(encodeURIComponent).join("/")}`;
    return sha256 ? `${base}?h=${encodeURIComponent(sha256)}` : base;
  }

  private async load(packId: string, decl: HostMeshAssetDecl): Promise<LoadedAsset | null> {
    if (this.assets.has(decl.id)) return this.assets.get(decl.id)!;
    let pending = this.pending.get(decl.id);
    if (!pending) {
      pending = this.loadInner(packId, decl);
      this.pending.set(decl.id, pending);
    }
    return pending;
  }

  private async loadInner(packId: string, decl: HostMeshAssetDecl): Promise<LoadedAsset | null> {
    const url = this.assetUrl(packId, decl.path, decl.sha256);
    try {
      const gltf = await this.loader.loadAsync(url);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!mesh && (obj as THREE.Mesh).isMesh) mesh = obj as THREE.Mesh;
      });
      if (!mesh) return null;
      const srcMesh: THREE.Mesh = mesh;
      const geometry = srcMesh.geometry.clone();
      const material = Array.isArray(srcMesh.material)
        ? srcMesh.material[0]!.clone()
        : srcMesh.material.clone();
      const instanced = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
      instanced.count = 0;
      instanced.frustumCulled = false;
      this.group.add(instanced);
      const row: LoadedAsset = { id: decl.id, root: gltf.scene, mesh: srcMesh, instanced };
      this.assets.set(decl.id, row);
      return row;
    } catch (e) {
      console.warn("zoto-viz host mesh:", decl.id, e);
      return null;
    } finally {
      this.pending.delete(decl.id);
    }
  }
}

export function parseHostMeshInstances(
  assetId: string,
  data: ArrayLike<number>,
  maxInstances = MAX_INSTANCES,
): HostMeshInstanceFrame | null {
  const n = Math.min(maxInstances, Math.floor(data.length / 16));
  if (n <= 0) return null;
  const matrices = new Float32Array(n * 16);
  for (let i = 0; i < n * 16; i++) matrices[i] = Number(data[i]) || 0;
  return { assetId, matrices };
}

export const HOST_MESH_MAX_FLOATS = MAX_FLOATS;
