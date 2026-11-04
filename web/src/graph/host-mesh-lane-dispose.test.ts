import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeHostMeshObject3D } from "./host-mesh-lane";

describe("disposeHostMeshObject3D scenery cleanup", () => {
  it("runs userData.dispose once and disposes instanced meshes", () => {
    const root = new THREE.Group();
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial(), 4);
    const spy = vi.spyOn(inst, "dispose");
    const own = vi.fn();
    root.userData.dispose = own;
    root.add(inst);
    disposeHostMeshObject3D(root);
    disposeHostMeshObject3D(root);
    expect(own).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
  });
});
