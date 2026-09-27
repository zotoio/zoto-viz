import { describe, expect, it } from "vitest";
import {
  flushHostMeshSlotWrites,
  hostMeshAssetMatchesConfig,
  hostMeshFrameReserveAfterSimWrites,
  hostMeshMatrixYSpin,
  hostMeshModelsEnabled,
  shouldWriteHostMeshMatrix,
  syncPackModelHostMeshAssets,
} from "./pack-host-mesh";
import { encodeHostMeshSlotPacket } from "./host-mesh-frame";
import { VIZ_WRITE_BATCH_MAX_BYTES, VIZ_WRITE_BATCH_MAX_MESSAGES } from "./viz-write-batch-caps";
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

  it("flushHostMeshSlotWrites stops before batch message cap", () => {
    const reserve = hostMeshFrameReserveAfterSimWrites({ uniformCount: 4 });
    const pkt = encodeHostMeshSlotPacket(0, [{ matrix: hostMeshMatrixYSpin(0), extras: {} }]);
    const writes: number[][] = [];
    const n = flushHostMeshSlotWrites(
      (_slot, data) => { writes.push([...data]); },
      3,
      99,
      Array.from({ length: 40 }, () => pkt),
      reserve,
    );
    expect(n).toBeLessThan(40);
    expect(reserve.messages + n).toBeLessThanOrEqual(VIZ_WRITE_BATCH_MAX_MESSAGES);
    expect(n).toBeGreaterThan(0);
  });

  it("flushHostMeshSlotWrites stops before batch byte cap", () => {
    const reserve = { messages: 0, bytes: VIZ_WRITE_BATCH_MAX_BYTES - 100 };
    const pkt = encodeHostMeshSlotPacket(0, [{ matrix: hostMeshMatrixYSpin(0), extras: {} }]);
    const n = flushHostMeshSlotWrites(
      () => {},
      3,
      10,
      [pkt, pkt, pkt],
      reserve,
    );
    expect(n).toBeLessThan(3);
  });
});
