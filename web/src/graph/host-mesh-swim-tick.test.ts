import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HostMeshLane, normalizeSwimClipStart } from "./host-mesh-lane";
import { encodeHostMeshSlotPacket, hostMeshMatrixYawPos } from "../../../plugins/sdk/host-mesh-frame";

type LiveRow = {
  action: THREE.AnimationAction;
  mixer: THREE.AnimationMixer;
};

type TemplateRow = {
  id: string;
  kind: string;
  template: THREE.Object3D;
  swimClip: THREE.AnimationClip;
  loadOk: boolean;
};

function swimClipWithTail(): THREE.AnimationClip {
  const times = new Float32Array([0, 0.5, 1]);
  const values = new Float32Array([
    0, 0, 0, 1,
    0, 0.2, 0, Math.sqrt(1 - 0.04),
    0, 0, 0, 1,
  ]);
  const track = new THREE.QuaternionKeyframeTrack("KoiTail.quaternion", times, values);
  return normalizeSwimClipStart(new THREE.AnimationClip("swim", 1, [track]))!;
}

function makeKoiRoot(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = "koi-test-root";
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial());
  tail.name = "KoiTail";
  root.add(tail);
  return root;
}

describe("HostMeshLane swim tick advances AnimationAction.time", () => {
  it("moves action.time across frames (not stuck at 0)", () => {
    const lane = new HostMeshLane();
    // Private maps via Reflect — no `as unknown as` (#192 cast guard).
    const templates = Reflect.get(lane, "templates") as Map<string, TemplateRow>;
    const skinnedLive = Reflect.get(lane, "skinnedLive") as Map<string, LiveRow[]>;

    lane.setAssetOrder(["koi"]);
    const clip = swimClipWithTail();
    templates.set("koi", {
      id: "koi",
      kind: "skinned",
      template: makeKoiRoot(),
      swimClip: clip,
      loadOk: true,
    });
    const matrix = hostMeshMatrixYawPos(0, 0, 0, 0, 1);
    lane.applySlotBuffer(
      encodeHostMeshSlotPacket(0, [{ matrix, extras: { animTime: 0.1, param1: 0, param2: 0, flags: 0 } }]),
    );
    const row = skinnedLive.get("koi")![0]!;
    expect(row.action.time).toBeCloseTo(0.1, 5);

    lane.tick(0.25);
    expect(row.action.time).toBeGreaterThan(0.3);
    const t1 = row.action.time;
    lane.tick(0.25);
    expect(row.action.time).not.toBe(0);
    expect(row.action.time).not.toBeCloseTo(t1, 5);
  });
});
