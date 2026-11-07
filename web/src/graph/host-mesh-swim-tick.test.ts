import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HostMeshLane, normalizeSwimClipStart } from "./host-mesh-lane";
import {
  encodeHostMeshSlotPacket,
  encodeHostMeshSlotPacketV3Mixed,
  hostMeshMatrixYawPos,
} from "../../../plugins/sdk/host-mesh-frame";

type LiveRow = {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  animOffset: number;
  clipDuration: number;
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
  const values = new Float32Array([0, 0, 0, 0, 0.35, 0, 0, 0.6, 0]);
  const track = new THREE.VectorKeyframeTrack("KoiTail.position", times, values);
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

function tailWorldY(root: THREE.Object3D): number {
  const tail = root.getObjectByName("KoiTail");
  if (!tail) return NaN;
  tail.updateMatrixWorld(true);
  return tail.getWorldPosition(new THREE.Vector3()).y;
}

function seedSkinnedLane(animTime: number): { lane: HostMeshLane; row: LiveRow } {
  const lane = new HostMeshLane();
  const templates = Reflect.get(lane, "templates") as Map<string, TemplateRow>;
  const skinnedLive = Reflect.get(lane, "skinnedLive") as Map<string, LiveRow[]>;
  lane.setAssetOrder(["koi"]);
  templates.set("koi", {
    id: "koi",
    kind: "skinned",
    template: makeKoiRoot(),
    swimClip: swimClipWithTail(),
    loadOk: true,
  });
  lane.applySlotBuffer(
    encodeHostMeshSlotPacket(0, [
      { matrix: hostMeshMatrixYawPos(0, 0, 0, 0, 1), extras: { animTime, param1: 0, param2: 0, flags: 0 } },
    ]),
  );
  const row = skinnedLive.get("koi")![0]!;
  return { lane, row };
}

describe("HostMeshLane swim tick (v2 packets + mixer.update(0) path)", () => {
  it("THREE contract: setTime samples pose; time+=update(0) does not", () => {
    const clip = swimClipWithTail();
    const rootA = makeKoiRoot();
    const mixerA = new THREE.AnimationMixer(rootA);
    mixerA.clipAction(clip).play();
    mixerA.setTime(0.5);
    expect(rootA.getObjectByName("KoiTail")!.position.y).toBeGreaterThan(0.1);

    const rootB = makeKoiRoot();
    const mixerB = new THREE.AnimationMixer(rootB);
    mixerB.clipAction(clip).play();
    mixerB.time = 0.5;
    mixerB.update(0);
    expect(rootB.getObjectByName("KoiTail")!.position.y).toBe(0);
  });

  it("samples changing tail world Y across ticks — not frozen at t=0", () => {
    const { lane, row } = seedSkinnedLane(0);
    lane.tick(1 / 60);
    const y0 = tailWorldY(row.root);

    lane.tick(0.4);
    const y1 = tailWorldY(row.root);
    lane.tick(0.4);
    const y2 = tailWorldY(row.root);

    expect(y1).not.toBeCloseTo(y0, 2);
    expect(y2).not.toBeCloseTo(y1, 2);
    expect(row.mixer.time).toBeGreaterThan(0.5);
  });

  it("honours animTime offset in sampled pose", () => {
    const a = seedSkinnedLane(0);
    const b = seedSkinnedLane(0.45);
    for (const { lane } of [a, b]) lane.tick(1 / 60);
    expect(tailWorldY(a.row.root)).not.toBeCloseTo(tailWorldY(b.row.root), 2);
    expect(b.row.animOffset).toBeCloseTo(0.45, 3);
  });

  it("v3 mixed flush still drives skinned instances with per-fish animTime", () => {
    const lane = new HostMeshLane();
    const templates = Reflect.get(lane, "templates") as Map<string, TemplateRow>;
    const skinnedLive = Reflect.get(lane, "skinnedLive") as Map<string, LiveRow[]>;
    lane.setAssetOrder(["scape", "koi"]);
    templates.set("koi", {
      id: "koi",
      kind: "skinned",
      template: makeKoiRoot(),
      swimClip: swimClipWithTail(),
      loadOk: true,
    });
    lane.applySlotBuffer(
      encodeHostMeshSlotPacketV3Mixed(
        [{ assetIndex: 1, x: 0, y: 0, z: 0, yaw: 0, scale: 1, animTime: 0.35 }],
        { flush: true },
      ),
    );
    const row = skinnedLive.get("koi")![0]!;
    lane.tick(1 / 60);
    const y0 = tailWorldY(row.root);
    lane.tick(0.35);
    const y1 = tailWorldY(row.root);
    expect(y1).not.toBeCloseTo(y0, 2);
    expect(row.animOffset).toBeCloseTo(0.35, 3);
  });
});
