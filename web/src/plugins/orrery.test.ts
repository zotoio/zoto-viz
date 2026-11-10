import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import FRAG from "../../../plugins/src/orrery/sky/fragment.glsl?raw";
import PLUGIN from "../../../plugins/src/orrery/plugin.yml?raw";
import { parseOrreryOptions } from "../../../plugins/src/orrery/frontend/config";
import {
  OR_SLOT,
  disposeOrreryPack,
  ingestFrame,
  packOrrerySlots,
  setOrreryOptions,
} from "../../../plugins/src/orrery/frontend/orrery";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildOrreryScenery } from "../graph/orrery-scenery";
import { orreryStagePose, stageMeshPose } from "../graph/stage-mesh-camera";
import { hostMeshDeclsForSet, hostMeshEnvironmentDecl, pinPackContents } from "../app/host-mesh-bridge";
import { disposeHostMeshObject3D, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import { parseVizContract } from "./viz-host";

const DT = 1 / 60;
function frame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY }, ...over };
}

const TALKERS = [
  { id: "a", rate: 300, role: "self" },
  { id: "b", rate: 120, role: "gateway" },
  { id: "c", rate: 40, role: "lan" },
  { id: "d", rate: 12, role: "internet" },
  { id: "e", rate: 3, role: "lan" },
];

function packSlots(frames: number): Float32Array[] {
  disposeOrreryPack();
  setOrreryOptions(parseOrreryOptions({}));
  let slots: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const fr = frame({ t: f * DT, talkers: TALKERS, packets: [{ proto: "TCP", size: 500, field: 0.3 }] });
    ingestFrame(fr);
    slots = packOrrerySlots(fr);
  }
  return slots;
}

/** A pinned-lane stand-in: the three GLB roots as the lane clones them (named node -> mesh child). */
function fakeLane() {
  const lane = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ metalness: 1 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const node = (parent: THREE.Object3D, name: string, m: THREE.Material = mat) => {
    const n = new THREE.Group();
    n.name = name;
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.setScalar(0.5);
    n.add(mesh);
    parent.add(n);
    return n;
  };
  const machine = new THREE.Group();
  for (const g of ["gear-crown", "gear-2", "gear-3", "escape-wheel", "anchor", "balance"]) node(machine, g);
  for (const p of ["arm-hub", "arm-bar", "arm-post", "arm-cup"]) node(machine, p).position.set(0, -5, 0);
  const sunMat = new THREE.MeshStandardMaterial({ emissive: 0xffcc88, emissiveIntensity: 0.9 });
  node(machine, "sun", sunMat);
  const planets = new THREE.Group();
  for (let k = 0; k < 7; k++) {
    const p = node(planets, `planet-${k}`, new THREE.MeshStandardMaterial());
    if (k === 6) node(p, "planet-6-ring");
  }
  const study = new THREE.Group();
  node(study, "desk-top", new THREE.MeshStandardMaterial({ metalness: 0 }));
  lane.add(study, machine, planets);
  return { lane, mat, sunMat, geo };
}

describe("orrery host", () => {
  it("validates plugin.yml viz contract", () => {
    const contract = parseVizContract({
      graphWalk: false, maxBuffers: 4, maxBufferFloats: 64, maxParticles: 0,
      uniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"],
      idle: { fixture: "host" }, hostMeshSlot: 7, hostMeshSlotCount: 1,
    });
    expect(contract?.hostMeshSlot).toBe(7);
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if (!("error" in wrapped)) expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("swaps every mesh to its -hd sibling for HD and lights HD with the environment image", () => {
    const decls: HostMeshAssetDecl[] = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+)\n(?:\s+role: (\S+)\n)?/g)]
      .map(([, id, path, role]) => ({ id: id!, path: path!, ...(role ? { role } : {}) }));
    expect(decls).toHaveLength(7);
    const std = hostMeshDeclsForSet(decls, "standard");
    const hd = hostMeshDeclsForSet(decls, "hd");
    expect(std.map((d) => d.path)).toEqual(["assets/orrery-study.glb", "assets/orrery-machine.glb", "assets/orrery-planets.glb"]);
    expect(hd.map((d) => d.id)).toEqual(["orrery-study", "orrery-machine", "orrery-planets"]);
    expect(hd.map((d) => d.path)).toEqual(["assets/orrery-study-hd.glb", "assets/orrery-machine-hd.glb", "assets/orrery-planets-hd.glb"]);
    expect(hostMeshEnvironmentDecl(decls, "standard")).toBeNull();
    expect(hostMeshEnvironmentDecl(decls, "hd")?.path).toBe("assets/env-hd.jpg");
  });

  it("pins all three GLBs at the origin and mounts the orrery scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "orrery");
    expect(packets.map((p) => p.slice(0, 3))).toEqual([[2, 0, 1], [2, 1, 1], [2, 2, 1]]);
    for (const p of packets) expect(p.slice(3, 19)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("orrery-scenery");
  });

  it("turns the gears, instances arms, planets and sparks from the slots without reallocating", () => {
    const slots = packSlots(400);
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane, sunMat } = fakeLane();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.planetCount).toBe(5);
    expect(sc.sparkCount).toBe(Math.round(slots[0]![OR_SLOT.sparks]!));
    const esc = lane.getObjectByName("escape-wheel")!;
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slots[0]![OR_SLOT.escape]!);
    expect(esc.quaternion.angleTo(want)).toBeLessThan(1e-5);
    expect(lane.getObjectByName("arm-hub")!.visible).toBe(false);
    expect(lane.getObjectByName("planet-0")!.visible).toBe(false);
    const inst = sc.root.getObjectByName("orrery-instances")!.children as THREE.InstancedMesh[];
    const hubs = inst.filter((m) => m.name === "arm-hub-instances");
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.count).toBe(7);
    // saturn carries its ring: two instanced meshes for planet-6
    expect(inst.filter((m) => m.name === "planet-6-instances")).toHaveLength(2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const bar = inst.find((x) => x.name === "arm-bar-instances")!;
    bar.getMatrixAt(6, m);
    p.setFromMatrixScale(m);
    expect(p.x / p.y).toBeCloseTo(0.4, 4);
    expect(sunMat.emissiveIntensity).toBeCloseTo(0.9 * (0.3 + 0.35 * slots[0]![OR_SLOT.sun]!), 5);
    const before = hubs[0]!.instanceMatrix.array;
    sc.update(read, DT);
    expect(hubs[0]!.instanceMatrix.array).toBe(before);
  });

  it("rebinds when a GLB lands after the first bind, keeping the gears' rest pose", () => {
    const slots = packSlots(400);
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane } = fakeLane();
    const planets = lane.children[2]!;
    lane.remove(planets);
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.planetCount).toBe(0);
    lane.add(planets);
    sc.update(read, DT);
    expect(sc.planetCount).toBe(5);
    expect(planets.getObjectByName("planet-0")!.visible).toBe(false);
    const esc = lane.getObjectByName("escape-wheel")!;
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), slots[0]![OR_SLOT.escape]!);
    expect(esc.quaternion.angleTo(want)).toBeLessThan(1e-5);
  });

  it("scenery dispose leaves the lane's shared template geometry and materials to the lane", () => {
    const slots = packSlots(30);
    const { lane, mat, geo } = fakeLane();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    const md = vi.spyOn(mat, "dispose");
    const gd = vi.spyOn(geo, "dispose");
    sc.root.removeFromParent();
    disposeHostMeshObject3D(sc.root);
    expect(md).not.toHaveBeenCalled();
    expect(gd).not.toHaveBeenCalled();
  });

  it("stage camera follows the pack and keeps the machine in narrow panes", () => {
    const slots = packSlots(30);
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const pose = stageMeshPose("orrery", read, 32 / 9);
    expect(pose?.position[2]).toBeCloseTo(slots[0]![OR_SLOT.eyeZ]!, 5);
    expect(pose?.fov).toBeCloseTo(30, 3);
    const tall = orreryStagePose(read, 0.6);
    expect(tall.fov!).toBeGreaterThan(30);
    const rest = orreryStagePose(() => 0, 2);
    expect(rest.target).toEqual([0, 0.2, 0]);
  });
});
