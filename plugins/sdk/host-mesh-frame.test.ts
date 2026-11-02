import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  decodeHostMeshSlotPacket,
  encodeHostMeshSlotPacket,
  hostMeshMatrixYawPos,
} from "./host-mesh-frame";

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
