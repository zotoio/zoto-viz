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
