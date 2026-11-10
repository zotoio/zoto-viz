import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildOrreryScenery, ORRERY_MAX_SPARKS } from "./orrery-scenery";
import { disposeHostMeshObject3D } from "./host-mesh-lane";
import { pinPackContents } from "../app/host-mesh-bridge";

const DT = 1 / 60;

/** Slot frames in the orrery pack's layout: slot0 machine state, slot1 8 x 8 arm floats, slots 2..3 sparks. */
function orrerySlots(opts: { arms?: number; sparks?: number; escape?: number; sun?: number } = {}) {
  const s0 = new Float32Array(64);
  const s1 = new Float32Array(64);
  const sp = [new Float32Array(64), new Float32Array(64)];
  s0[10] = opts.escape ?? 0.7;
  s0[11] = 0.1;
  s0[12] = -0.4;
  s0[13] = 0.3;
  s0[14] = -0.5;
  s0[15] = 0.9;
  s0[16] = opts.sun ?? 0.8;
  s0[19] = opts.sparks ?? 6;
  s0[23] = 0.7;
  const arms = opts.arms ?? 5;
  for (let k = 0; k < arms; k++) {
    const o = k * 8;
    s1.set([k * 0.8, 0.1 + 0.05 * k, 0.33 - 0.026 * k, k % 7, 0.01 + 0.002 * k, k * 0.3, 1, 0], o);
  }
  for (let i = 0; i < (opts.sparks ?? 6); i++) {
    sp[Math.floor(i / 16)]!.set([0.01 * i, 0.1, -0.01 * i, 40 + 0.5], (i % 16) * 4);
  }
  const slots = [s0, s1, ...sp];
  return (slot: number, i: number) => slots[slot]?.[i] ?? 0;
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

describe("orrery scenery", () => {
  it("pins all three GLBs at the origin and mounts the orrery scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "orrery");
    expect(packets.map((p) => p.slice(0, 3))).toEqual([[2, 0, 1], [2, 1, 1], [2, 2, 1]]);
    for (const p of packets) expect(p.slice(3, 19)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("orrery-scenery");
  });

  it("stays unbound and draws nothing before the pack's GLBs are on the lane", () => {
    const lane = new THREE.Group();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update(orrerySlots({ sparks: 0 }), DT);
    expect(sc.bound).toBe(false);
    expect(sc.planetCount).toBe(0);
    expect(sc.sparkCount).toBe(0);
  });

  it("turns the gears, instances arms, planets and sparks from the slots without reallocating", () => {
    const read = orrerySlots({ arms: 7, sparks: 20, escape: 1.1, sun: 1 });
    const { lane, sunMat } = fakeLane();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.planetCount).toBe(7);
    expect(sc.sparkCount).toBe(20);
    const esc = lane.getObjectByName("escape-wheel")!;
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
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
    expect(sunMat.emissiveIntensity).toBeCloseTo(0.9 * (0.3 + 0.35 * 1), 5);
    const before = hubs[0]!.instanceMatrix.array;
    sc.update(read, DT);
    expect(hubs[0]!.instanceMatrix.array).toBe(before);
  });

  it("caps sparks at the pool size", () => {
    const { lane } = fakeLane();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    const read = orrerySlots({ sparks: 32 });
    sc.update((slot, i) => (slot === 0 && i === 19 ? 500 : read(slot, i)), DT);
    expect(sc.sparkCount).toBe(ORRERY_MAX_SPARKS);
  });

  it("rebinds when a GLB lands after the first bind, keeping the gears' rest pose", () => {
    const read = orrerySlots();
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
    const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
    expect(esc.quaternion.angleTo(want)).toBeLessThan(1e-5);
  });

  it("scenery dispose leaves the lane's shared template geometry and materials to the lane", () => {
    const { lane, mat, geo } = fakeLane();
    const sc = buildOrreryScenery();
    lane.add(sc.root);
    sc.update(orrerySlots(), DT);
    const md = vi.spyOn(mat, "dispose");
    const gd = vi.spyOn(geo, "dispose");
    sc.root.removeFromParent();
    disposeHostMeshObject3D(sc.root);
    expect(md).not.toHaveBeenCalled();
    expect(gd).not.toHaveBeenCalled();
  });
});
