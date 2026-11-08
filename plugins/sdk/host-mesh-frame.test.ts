import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeHostMeshSlotPacket,
  encodeHostMeshSlotPacket,
  encodeHostMeshSlotPacketV3Mixed,
  HOST_MESH_FRAME_V3,
  HOST_MESH_V3_MAX_INSTANCES,
  hostMeshMatrixYawPos,
} from "./host-mesh-frame";

describe("host-mesh-frame v3 mixed", () => {
  it("round-trips up to four mixed-asset fish and marks flush on last packet", () => {
    const raw = encodeHostMeshSlotPacketV3Mixed(
      [
        { assetIndex: 1, x: 0.1, y: 0.2, z: 0.3, yaw: 0.5, scale: 0.48, animTime: 1.1 },
        { assetIndex: 3, x: -0.2, y: 0.04, z: 0.8, yaw: -0.3, animTime: 0.5 },
      ],
      { flush: true },
    );
    const pkt = decodeHostMeshSlotPacket(raw);
    expect(pkt?.version).toBe(HOST_MESH_FRAME_V3);
    expect(pkt?.instances.length).toBe(2);
    expect(pkt?.v3Flush).toBe(true);
    expect(pkt?.instances[0]?.meshAssetIndex).toBe(1);
    expect(pkt?.instances[1]?.meshAssetIndex).toBe(3);
    expect(pkt?.instances[0]?.matrix[12]).toBeCloseTo(0.1);
  });

  it("fits sixteen fish in two packets at max instance stride", () => {
    const chunkA = Array.from({ length: HOST_MESH_V3_MAX_INSTANCES }, (_, i) => ({
      assetIndex: (i % 3) + 1,
      x: i * 0.01,
      y: 0.04,
      z: i * 0.02,
      yaw: i * 0.1,
    }));
    const chunkB = Array.from({ length: 16 - HOST_MESH_V3_MAX_INSTANCES }, (_, i) => ({
      assetIndex: ((i + HOST_MESH_V3_MAX_INSTANCES) % 3) + 1,
      x: i,
      y: 0.04,
      z: i,
      yaw: 0,
    }));
    expect(HOST_MESH_V3_MAX_INSTANCES).toBeGreaterThanOrEqual(8);
    const packs = [
      encodeHostMeshSlotPacketV3Mixed(chunkA),
      encodeHostMeshSlotPacketV3Mixed(chunkB, { flush: true }),
    ];
    let n = 0;
    for (const raw of packs) {
      const pkt = decodeHostMeshSlotPacket(raw);
      n += pkt?.instances.length ?? 0;
    }
    expect(n).toBe(16);
  });
});

describe("host-mesh-frame v2", () => {
  it("round-trips slot packets", () => {
    const raw = encodeHostMeshSlotPacket(2, [
      { matrix: hostMeshMatrixYawPos(1, 2, 3, 0.5), extras: { animTime: 1.2, param1: 0, param2: 0, flags: 0 } },
    ]);
    const pkt = decodeHostMeshSlotPacket(raw);
    expect(pkt?.assetIndex).toBe(2);
    expect(pkt?.instances.length).toBe(1);
    expect(pkt?.instances[0]?.matrix[12]).toBeCloseTo(1);
  });
});

describe("hostMeshMatrixYawPos: the model's nose points along the heading", () => {
  // Fish, koi and cars move by x += sin(yaw), z += cos(yaw), and their models face local +Z.
  // Revert: the old rotation sent +Z to (-sin, cos), so anything heading sideways swam backwards.
  it("sends local +Z to (sin yaw, 0, cos yaw), and the yaw reads back from that column", () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.4, -1.4, -Math.PI / 2]) {
      const scale = 1.35;
      const m = hostMeshMatrixYawPos(0.1, 0.2, 0.3, yaw, scale);
      const nose = [m[8]! / scale, m[9]! / scale, m[10]! / scale];
      expect(nose[0]).toBeCloseTo(Math.sin(yaw), 6);
      expect(nose[1]).toBeCloseTo(0, 6);
      expect(nose[2]).toBeCloseTo(Math.cos(yaw), 6);
      const step = [Math.sin(yaw), Math.cos(yaw)];
      expect(nose[0]! * step[0]! + nose[2]! * step[1]!, `yaw ${yaw}: nose leads the motion`).toBeGreaterThan(0.99);
      expect(Math.atan2(m[8]!, m[10]!)).toBeCloseTo(Math.atan2(Math.sin(yaw), Math.cos(yaw)), 6);
    }
  });
});

describe("host mesh loader gaps (revert proofs)", () => {
  const lanePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/src/graph/host-mesh-lane.ts");
  const src = readFileSync(lanePath, "utf8");

  const REVERT_FIRST_MESH_ONLY = "if (!mesh && (obj as THREE.Mesh).isMesh) mesh = obj as THREE.Mesh";

  it("registers meshopt decoder (gap 1)", () => {
    expect(src).toContain("setMeshoptDecoder");
    expect(src).toContain("MeshoptDecoder");
  });

  it("revert row first-mesh-only would reappear in loader", () => {
    expect(src).not.toContain(REVERT_FIRST_MESH_ONLY);
    expect(src + REVERT_FIRST_MESH_ONLY).toContain(REVERT_FIRST_MESH_ONLY);
  });

  it("clones full rigid scenes (gap 2 multi-node)", () => {
    expect(src).toContain("template.clone(true)");
    expect(src).toContain("getObjectByName");
  });

  it("plays skinned swim clips with mixers (gap 3)", () => {
    expect(src).toContain("AnimationMixer");
    expect(src).toContain('a.name === "swim"');
    expect(src).toContain("animOffset");
  });
});
