import { describe, expect, it } from "vitest";
import {
  hostMeshAssetMatchesConfig,
  hostMeshMatrixYSpin,
  hostMeshModelsEnabled,
  shouldWriteHostMeshMatrix,
  syncPackModelHostMeshAssets,
} from "./pack-host-mesh";
import { PackModelSlotController } from "./pack-model-slot";

describe("pack-host-mesh", () => {
  it("matches modelGlb to declared asset path or id", () => {
    const asset = { id: "car", path: "assets/car.glb" };
    expect(hostMeshAssetMatchesConfig({ modelGlb: "assets/car.glb" }, asset)).toBe(true);
    expect(hostMeshAssetMatchesConfig({ modelGlb: "car" }, asset)).toBe(true);
    expect(hostMeshAssetMatchesConfig({ modelGlb: "other.glb" }, asset)).toBe(false);
  });

  it("hostMeshModelsEnabled treats host and procedural separately", () => {
    expect(hostMeshModelsEnabled({ modelGlb: "host" })).toBe(true);
    expect(hostMeshModelsEnabled({ modelGlb: "procedural" })).toBe(false);
  });

  it("syncPackModelHostMeshAssets sets ready for host mode", () => {
    const c = new PackModelSlotController({ modelGlb: "host" });
    syncPackModelHostMeshAssets(c, { modelGlb: "host" });
    expect(shouldWriteHostMeshMatrix(c.snapshot())).toBe(true);
  });

  it("emits 16-float column-major matrix helper", () => {
    const m = hostMeshMatrixYSpin(1.5);
    expect(m.length).toBe(16);
    expect(m[15]).toBe(1);
  });
});
