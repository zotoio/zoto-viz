import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeHostMeshObject3D, HostMeshLane } from "./host-mesh-lane";

describe("host mesh lane", () => {
  it("parses instance matrices from a buffer slot", async () => {
    const { parseHostMeshInstances } = await import("./host-mesh-lane");
    const data = new Array(16).fill(0);
    data[0] = 1;
    data[5] = 1;
    data[10] = 1;
    data[15] = 1;
    const frame = parseHostMeshInstances("cube", data);
    expect(frame?.assetId).toBe("cube");
    expect(frame?.matrices.length).toBe(16);
  });

  it("disposeHostMeshObject3D disposes mesh geometry and material", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    const geoSpy = vi.spyOn(geo, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    const n = disposeHostMeshObject3D(mesh);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("clear() disposes loaded templates and bumps load epoch", () => {
    const lane = new HostMeshLane();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    const root = new THREE.Group();
    root.add(mesh);
    (lane as unknown as { templates: Map<string, unknown> }).templates.set("x", {
      id: "x",
      kind: "rigid",
      template: root,
      swimClip: null,
      loadOk: true,
    });
    const geoSpy = vi.spyOn(geo, "dispose");
    lane.clear();
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect((lane as unknown as { loadEpoch: number }).loadEpoch).toBeGreaterThan(0);
  });
});
