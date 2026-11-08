import { describe, expect, it } from "vitest";
import { decodeHostMeshSlotPacket, HOST_MESH_FRAME_V3 } from "../../../sdk/host-mesh-frame";
import {
  collectKoiMeshRows,
  KOI_HOST_MESH_BASE_SLOT,
  KOI_HOST_MESH_MAX_INSTANCES,
  KOI_HOST_MESH_SLOT_COUNT,
  writeKoiHostMeshSlots,
} from "./host-mesh-drive";
import { KOI_SLOT, MAX_KOI } from "./koi-pond";

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
      expect(w.data[0]).toBe(HOST_MESH_FRAME_V3);
    }
    expect(writes.some((w) => w.slot === 3)).toBe(false);
  });

  it("at max koi (16) emits all species in v3 packets without silent drops", () => {
    const distributions: number[][] = [
      Array.from({ length: 16 }, (_, i) => i % 6),
      [...Array(6).fill(0), ...Array(5).fill(2), ...Array(5).fill(3)],
      Array.from({ length: 16 }, () => 0),
    ];
    for (const patterns of distributions) {
      const slot0 = new Float32Array(64);
      const slot1 = new Float32Array(64);
      slot0[KOI_SLOT.koiCount] = 16;
      for (let i = 0; i < 16; i++) {
        const fi = i * 4;
        slot1[fi] = Math.sin(i);
        slot1[fi + 2] = Math.cos(i);
        slot1[fi + 3] = i * 0.1;
        slot0[KOI_SLOT.koiMeta0 + i] = patterns[i]!;
      }
      const rows = collectKoiMeshRows(slot0, slot1, 2);
      expect(rows.length).toBe(16);
      const assets = new Set(rows.map((r) => r.assetIndex));
      if (patterns.some((p) => p === 0 || p === 1)) expect(assets.has(1)).toBe(true);
      if (patterns.some((p) => p === 2 || p === 5)) expect(assets.has(2)).toBe(true);
      if (patterns.some((p) => p === 3 || p === 4)) expect(assets.has(3)).toBe(true);

      const writes: { slot: number; data: number[] }[] = [];
      writeKoiHostMeshSlots((slot, data) => {
        writes.push({ slot, data: Array.from(data) });
      }, slot0, slot1, 2);
      expect(writes.length).toBeLessThanOrEqual(KOI_HOST_MESH_SLOT_COUNT);
      let instances = 0;
      const wireAssets = new Set<number>();
      for (const w of writes) {
        const pkt = decodeHostMeshSlotPacket(w.data);
        expect(pkt?.version).toBe(HOST_MESH_FRAME_V3);
        for (const inst of pkt?.instances ?? []) {
          instances += 1;
          if (inst.meshAssetIndex !== undefined) wireAssets.add(inst.meshAssetIndex);
        }
      }
      expect(instances).toBe(16);
      expect(wireAssets.size).toBeGreaterThanOrEqual(1);
    }
  });

  it("exposes MAX_KOI as the supported mesh instance budget", () => {
    expect(KOI_HOST_MESH_MAX_INSTANCES).toBe(MAX_KOI);
  });
});
