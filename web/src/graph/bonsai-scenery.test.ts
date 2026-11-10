import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { BONSAI_TURNTABLE, buildBonsaiScenery, patchFoliageMaterial } from "./bonsai-scenery";
import { bonsaiStagePose, stageMeshPose } from "./stage-mesh-camera";
import { pinPackContents } from "../app/host-mesh-bridge";
import { disposeHostMeshObject3D } from "./host-mesh-lane";
import { mockPartial } from "../../test-support/mock-partial";

const DT = 1 / 60;

/** Hand-built pack slots: two blossoms, one leaf falling and one resting on the slab. */
function syntheticSlots(): Float32Array[] {
  const s = Array.from({ length: 6 }, () => new Float32Array(64));
  s[0]!.set([1, 0.02, 0.58, 1.47, 0, 0.27, 0, 30], 0); // live, eye, aim, fov
  s[0]![8] = 0.5; // yaw
  s[0]![11] = 0.8; // warmth
  s[0]![12] = 0.3; // sun
  s[0]![13] = 0.9; // light
  s[0]![15] = 2; // blossoms
  s[0]![16] = 2; // falling
  s[0]![22] = 0.5; // breeze
  for (let k = 0; k < 16; k++) { s[1]![k * 2] = 0.4 + k * 0.01; s[1]![k * 2 + 1] = k / 16; }
  s[2]!.set([0.1, 0.3, 0.0, 0 + 0.45, -0.1, 0.32, 0.05, 3 + 0.4]);
  s[4]!.set([0.05, 0.2, 0.1, 1.2, -0.1, 0.05, 0.02, 0.3]);
  s[5]!.set([0, 0.9, 1.0, 0, 2, 1.0, 2.0, 1]);
  return s;
}

/** A pinned-lane stand-in: the two GLB roots as the lane clones them (named node -> mesh child). */
function fakeLane() {
  const lane = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const node = (parent: THREE.Object3D, name: string, m: THREE.Material = mat) => {
    const n = new THREE.Group();
    n.name = name;
    n.position.set(0.1, 0, 0);
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.setScalar(0.5);
    n.add(mesh);
    parent.add(n);
    return n;
  };
  const base = new THREE.Group();
  for (const name of ["bench", "board", "rock", "moss", "contact-shadow"]) node(base, name);
  const tree = new THREE.Group();
  node(tree, "trunk");
  node(tree, "foliage", leafMat);
  node(tree, "blossom-card").position.set(0, -3, 0);
  node(tree, "falling-leaf").position.set(0.1, -3, 0);
  lane.add(base, tree);
  return { lane, mat, leafMat, geo, base, tree };
}

describe("bonsai scenery", () => {
  it("pins both GLBs at the origin and mounts the bonsai scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "bonsai");
    expect(packets.map((p) => p.slice(0, 3))).toEqual([[2, 0, 1], [2, 1, 1]]);
    for (const p of packets) expect(p.slice(3, 19)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("bonsai-scenery");
  });

  it("turns the board group by the slot yaw, leaves the bench, and feeds the foliage shader", () => {
    const slots = syntheticSlots();
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane, leafMat } = fakeLane();
    const sc = buildBonsaiScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.foliagePatched).toBe(true);
    for (const name of BONSAI_TURNTABLE) {
      const n = lane.getObjectByName(name)!;
      const p = new THREE.Vector3().setFromMatrixPosition(n.matrix);
      expect(p.x).toBeCloseTo(0.1 * Math.cos(0.5), 5);
      expect(p.z).toBeCloseTo(-0.1 * Math.sin(0.5), 5);
    }
    const bench = lane.getObjectByName("bench")!;
    bench.updateMatrix();
    expect(new THREE.Vector3().setFromMatrixPosition(bench.matrix).x).toBeCloseTo(0.1, 6);
    // a second frame turns from the rest pose, not from the last frame
    sc.update(read, DT);
    expect(new THREE.Vector3().setFromMatrixPosition(lane.getObjectByName("board")!.matrix).x).toBeCloseTo(0.1 * Math.cos(0.5), 5);
    const u = leafMat.userData.bonsaiFoliage as { uBsPresence: { value: Float32Array }; uBsAutumn: { value: Float32Array }; uBsSway: { value: number } };
    expect(u.uBsPresence.value[3]).toBeCloseTo(0.43, 5);
    expect(u.uBsAutumn.value[8]).toBeCloseTo(0.5, 5);
    expect(u.uBsSway.value).toBeGreaterThan(0);
  });

  it("shows every leaf, green, before the pack's first frame", () => {
    const { lane, leafMat } = fakeLane();
    const sc = buildBonsaiScenery();
    lane.add(sc.root);
    sc.update(() => 0, DT);
    const u = leafMat.userData.bonsaiFoliage as { uBsPresence: { value: Float32Array }; uBsAutumn: { value: Float32Array } };
    expect(Math.min(...u.uBsPresence.value)).toBe(1);
    expect(Math.max(...u.uBsAutumn.value)).toBe(0);
    expect(sc.blossomCount).toBe(0);
    expect(sc.fallingCount).toBe(0);
  });

  it("instances blossoms and falling leaves from the slots without reallocating", () => {
    const slots = syntheticSlots();
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane } = fakeLane();
    const sc = buildBonsaiScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.blossomCount).toBe(2);
    expect(sc.fallingCount).toBe(2);
    expect(lane.getObjectByName("blossom-card")!.visible).toBe(false);
    expect(lane.getObjectByName("falling-leaf")!.visible).toBe(false);
    const inst = sc.root.getObjectByName("bonsai-instances")!.children as THREE.InstancedMesh[];
    const blossoms = inst.find((m) => m.name === "blossom-instances")!;
    const leaves = inst.find((m) => m.name === "falling-leaf-instances")!;
    expect(blossoms.count).toBe(2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    // blossom 0 sits at its board-local point turned by the yaw (the template mesh is offset inside its node)
    blossoms.getMatrixAt(0, m);
    m.decompose(p, q, s);
    const want = new THREE.Vector3(0.1, 0.3, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    expect(p.distanceTo(want)).toBeLessThan(0.06);
    // the resting leaf lies flat: its card normal (+y) stays up
    leaves.getMatrixAt(1, m);
    m.decompose(p, q, s);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y).toBeCloseTo(1, 5);
    // the plum tint (3) on blossom 1
    const c = new THREE.Color();
    blossoms.getColorAt(1, c);
    expect(c.g).toBeLessThan(c.b);
    const before = blossoms.instanceMatrix.array;
    sc.update(read, DT);
    expect(blossoms.instanceMatrix.array).toBe(before);
  });

  it("patches the foliage shader on chunks three still ships", () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    patchFoliageMaterial(mat);
    expect(patchFoliageMaterial(mat)).toBe(mat.userData.bonsaiFoliage);
    const shader = mockPartial<THREE.WebGLProgramParametersWithUniforms>({
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    });
    for (const chunk of ["#include <common>", "#include <begin_vertex>"]) expect(shader.vertexShader).toContain(chunk);
    for (const chunk of ["#include <clipping_planes_fragment>", "#include <map_fragment>", "#include <color_fragment>", "#include <normal_fragment_begin>"]) {
      expect(shader.fragmentShader).toContain(chunk);
    }
    expect(THREE.ShaderChunk.normal_fragment_begin).toContain("gl_FrontFacing ? 1.0 : - 1.0");
    mat.onBeforeCompile(shader, mockPartial<THREE.WebGLRenderer>({}));
    expect(shader.uniforms.uBsPresence).toBeDefined();
    expect(shader.vertexShader).toContain("floor( color.g * 16.0 )");
    expect(shader.vertexShader).not.toContain("#include <begin_vertex>");
    expect(shader.fragmentShader).toContain("if ( vBsKeep < 0.0 ) discard;");
    expect(shader.fragmentShader).toContain("diffuseColor.rgb *= vColor.r;");
    expect(shader.fragmentShader).toContain("float faceDirection = 1.0;");
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
  });

  it("rebinds when the tree GLB lands after the first bind", () => {
    const slots = syntheticSlots();
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane, tree } = fakeLane();
    lane.remove(tree);
    const sc = buildBonsaiScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(false);
    lane.add(tree);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.blossomCount).toBe(2);
  });

  it("scenery dispose leaves the lane's shared template geometry and materials to the lane", () => {
    const slots = syntheticSlots();
    const { lane, mat, geo } = fakeLane();
    const sc = buildBonsaiScenery();
    lane.add(sc.root);
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    const md = vi.spyOn(mat, "dispose");
    const gd = vi.spyOn(geo, "dispose");
    sc.root.removeFromParent();
    disposeHostMeshObject3D(sc.root);
    expect(md).not.toHaveBeenCalled();
    expect(gd).not.toHaveBeenCalled();
  });

  it("stage camera follows the pack and keeps the board in narrow panes", () => {
    const slots = syntheticSlots();
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const pose = stageMeshPose("bonsai", read, 32 / 9);
    expect(pose?.position).toEqual([slots[0]![1], slots[0]![2], slots[0]![3]]);
    expect(pose?.target[1]).toBeCloseTo(0.27, 5);
    expect(pose?.fov).toBeCloseTo(30, 3);
    expect(bonsaiStagePose(read, 0.6).fov!).toBeGreaterThan(30);
    expect(bonsaiStagePose(() => 0, 2).target).toEqual([0, 0.27, 0]);
  });
});
