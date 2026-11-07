import { describe, expect, it } from "vitest";
import { HOST_MESH_FRAME_V2 } from "../../../sdk/host-mesh-frame";
import { KOI_HOST_MESH_BASE_SLOT, KOI_HOST_MESH_SLOT_COUNT, writeKoiHostMeshSlots } from "./host-mesh-drive";
import { KOI_SLOT } from "./koi-pond";

describe("writeKoiHostMeshSlots slot layout", () => {
  it("uses slots 4..7 only (slot 3 reserved for follow cam; maxBuffers 8)", () => {
    const slot0 = new Float32Array(64);
    const slot1 = new Float32Array(64);
    slot0[KOI_SLOT.koiCount] = 12;
    for (let i = 0; i < 12; i++) {
      const fi = i * 4;
      slot1[fi] = (i - 6) * 0.1;
      slot1[fi + 2] = i * 0.05;
      slot1[fi + 3] = i * 0.2;
      slot0[KOI_SLOT.koiMeta0 + i] = i % 6;
    }
    const writes: { slot: number; data: number[] }[] = [];
    writeKoiHostMeshSlots((slot, data) => {
      writes.push({ slot, data: Array.from(data) });
    }, slot0, slot1, 1.5);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.length).toBeLessThanOrEqual(KOI_HOST_MESH_SLOT_COUNT);
    for (const w of writes) {
      expect(w.slot).toBeGreaterThanOrEqual(KOI_HOST_MESH_BASE_SLOT);
      expect(w.slot).toBeLessThan(KOI_HOST_MESH_BASE_SLOT + KOI_HOST_MESH_SLOT_COUNT);
      expect(w.data[0]).toBe(HOST_MESH_FRAME_V2);
    }
    expect(writes.some((w) => w.slot === 3)).toBe(false);
    expect(Math.max(...writes.map((w) => w.slot))).toBeLessThanOrEqual(7);
  });
});
