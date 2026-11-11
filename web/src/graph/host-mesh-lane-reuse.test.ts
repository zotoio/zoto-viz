import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hostMeshLane from "./host-mesh-lane";
import { HostMeshLane } from "./host-mesh-lane";

/** Every-frame slot packets must move live fish, not re-clone them (a new bone texture each time). */
function skinnedRoot(): THREE.Group {
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

function packet(n: number, x: number): number[] {
  const out = [2, 0, n];
  for (let i = 0; i < n; i++) out.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x + i, 0, 0, 1, 0, 0, 0, 0);
  return out;
}

describe("host mesh lane reuses live instances across packets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves the same skinned copies over N ticks and disposes skeletons when the count changes", async () => {
    vi.spyOn(hostMeshLane, "ensureHostMeshoptDecoder").mockResolvedValue(undefined);
    const lane = new HostMeshLane();
    const clip = new THREE.AnimationClip("swim", 1, []);
    vi.spyOn(Reflect.get(lane, "loader"), "loadAsync").mockResolvedValue({ scene: skinnedRoot(), animations: [clip], asset: {}, cameras: [], parser: null, userData: {} });
    lane.setAssetOrder(["koi"]);
    await Reflect.get(lane, "load").call(lane, "koi-pond", { id: "koi", path: "koi.glb" });
    lane.applySlotBuffer(packet(3, 0));
    const first = [...lane.group.children];
    expect(first).toHaveLength(3);
    const xs: number[] = [];
    for (let t = 1; t <= 30; t++) {
      lane.applySlotBuffer(packet(3, t * 0.1));
      expect(lane.group.children).toEqual(first);
      xs.push(first[0]!.matrix.elements[12]!);
    }
    expect(new Set(xs).size).toBe(30);
    const spy = vi.spyOn(THREE.Skeleton.prototype, "dispose");
    lane.applySlotBuffer(packet(2, 0));
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
