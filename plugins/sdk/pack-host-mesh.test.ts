import { describe, expect, it } from "vitest";
import {
  HOST_MESH_MATRIX_FLOATS,
  applyHostMeshAssetReady,
  hostMeshAssetMatchesConfig,
  hostMeshMatrixYSpin,
  shouldWriteHostMeshMatrix,
  syncPackModelHostMesh,
} from "./pack-host-mesh";
import { PackModelSlotController, initialPackModelSlotState, useProceduralArt } from "./pack-model-slot";

describe("pack-host-mesh", () => {
  it("matches modelGlb to declared asset path or id", () => {
    const asset = { id: "car", path: "assets/car.glb" };
    expect(hostMeshAssetMatchesConfig({ modelGlb: "assets/car.glb" }, asset)).toBe(true);
    expect(hostMeshAssetMatchesConfig({ modelGlb: "car" }, asset)).toBe(true);
    expect(hostMeshAssetMatchesConfig({ modelGlb: "other.glb" }, asset)).toBe(false);
  });

  it("marks host mesh ready without sandbox fetch", () => {
    const base = initialPackModelSlotState({ modelGlb: "assets/car.glb" });
    const ready = applyHostMeshAssetReady(base);
    expect(useProceduralArt(ready)).toBe(false);
  });

  it("syncPackModelHostMesh sets ready when asset matches", () => {
    const c = new PackModelSlotController({ modelGlb: "assets/car.glb" });
    syncPackModelHostMesh(c, { modelGlb: "assets/car.glb" }, { id: "car", path: "assets/car.glb" });
    expect(shouldWriteHostMeshMatrix(c.snapshot())).toBe(true);
  });

  it("emits 16-float column-major matrix", () => {
    const m = hostMeshMatrixYSpin(1.5);
    expect(m.length).toBe(HOST_MESH_MATRIX_FLOATS);
    expect(m[15]).toBe(1);
  });
});
