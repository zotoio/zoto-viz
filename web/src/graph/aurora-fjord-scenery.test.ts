import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AF_CABIN,
  AF_CABIN_FLOATS,
  AF_CABIN_SLOT,
  AF_MAX_RIPPLES,
  AF_RIPPLE_SLOT,
  AF_SLOT,
  buildAuroraFjordScenery,
  patchFjordMaterial,
} from "./aurora-fjord-scenery";
import { pinPackContents } from "../app/host-mesh-bridge";
import { disposeHostMeshObject3D } from "./host-mesh-lane";
import { mockPartial } from "../../test-support/mock-partial";

const DT = 1 / 60;

/** Hand-built pack slots: two lit cabins, three ripples, a little fog. */
function syntheticSlots(): Float32Array[] {
  const s = Array.from({ length: 3 }, () => new Float32Array(64));
  s[0]!.set([1, 8, 14, 40, 0, 92, -800, 34], 0); // live, eye, aim, fov
  s[0]![AF_SLOT.strength] = 0.7;
  s[0]![AF_SLOT.storm] = 0.2;
  s[0]![AF_SLOT.fog] = 0.3;
  s[0]![AF_SLOT.ripples] = 3;
  s[0]![AF_SLOT.moon] = 0.6;
  s[0]![AF_SLOT.fogFront] = -900;
  s[0]![AF_SLOT.calm] = 0.8;
  s[0]!.set([0.06, 0.08, 0.11], AF_SLOT.hazeR);
  s[0]!.set([0.3, 1.0, 0.55], AF_SLOT.auroraR);
  for (const [k, light] of [[0, 0.9], [1, 0.4]] as const) {
    const o = k * AF_CABIN_FLOATS;
    s[AF_CABIN_SLOT]![o + AF_CABIN.light] = light;
    s[AF_CABIN_SLOT]![o + AF_CABIN.present] = 1;
    s[AF_CABIN_SLOT]![o + AF_CABIN.shoreX] = 230 + k * 10;
    s[AF_CABIN_SLOT]![o + AF_CABIN.shoreZ] = -250 - k * 40;
  }
  s[AF_RIPPLE_SLOT]!.set([200, -240, 6, 90 + 0.8, 210, -300, 12, 120 + 0.5, 0, 0, 0, 0]);
  return s;
}

/** A pinned-lane stand-in: the two GLB roots as the lane clones them (named node -> mesh child). */
function fakeLane() {
  const lane = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const node = (parent: THREE.Object3D, name: string, mat: THREE.Material) => {
    const n = new THREE.Group();
    n.name = name;
    n.add(new THREE.Mesh(geo, mat));
    parent.add(n);
    return n;
  };
  const terrain = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true });
  node(terrain, "terrain", rock);
  const shore = new THREE.Group();
  const cabin = new THREE.MeshStandardMaterial();
  node(shore, "cabins", cabin);
  node(shore, "pines", new THREE.MeshStandardMaterial({ alphaTest: 0.5 }));
  const windows = [0, 1, 2].map((k) => {
    const m = new THREE.MeshStandardMaterial({ emissive: 0xff9e4d });
    node(shore, `cabin-window-${k}`, m);
    return m;
  });
  lane.add(terrain, shore);
  return { lane, geo, rock, cabin, windows };
}

describe("aurora fjord scenery", () => {
  it("pins both GLBs at the origin and mounts the aurora-fjord scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "aurora-fjord");
    expect(packets.map((p) => p.slice(0, 3))).toEqual([[2, 0, 1], [2, 1, 1]]);
    for (const p of packets) expect(p.slice(3, 19)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("aurora-fjord-scenery");
  });

  it("stays unbound and draws nothing until the GLBs are on the lane", () => {
    const sc = buildAuroraFjordScenery();
    const lane = new THREE.Group();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    expect(sc.bound).toBe(false);
    expect(sc.rippleCount).toBe(0);
    expect(sc.streakCount).toBe(0);
  });

  it("mirrors every lane mesh under the water with unlit copies and patches the originals", () => {
    const { lane, rock } = fakeLane();
    const sc = buildAuroraFjordScenery();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    expect(sc.bound).toBe(true);
    expect(sc.mirrorMeshes).toBe(6);
    expect(sc.windows).toBe(3);
    const mirror = sc.root.getObjectByName("aurora-fjord-mirror")!;
    expect(mirror.scale.y).toBe(-1);
    const copy = mirror.getObjectByName("terrain")!.children[0] as THREE.Mesh;
    expect((copy.material as THREE.Material).type).toBe("MeshBasicMaterial");
    expect((copy.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
    expect(copy.geometry).toBe((lane.getObjectByName("terrain")!.children[0] as THREE.Mesh).geometry);
    expect(rock.userData.auroraFjord).toEqual({ side: 1 });
    expect((copy.material as THREE.Material).userData.auroraFjord).toEqual({ side: -1 });
    expect(rock.fog).toBe(false);
    // the pine cut-out carries into its reflection
    const pine = mirror.getObjectByName("pines")!.children[0] as THREE.Mesh;
    expect((pine.material as THREE.MeshBasicMaterial).alphaTest).toBe(0.5);
    // a second frame does not rebuild the reflection
    const first = mirror.children[0];
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    expect(mirror.children[0]).toBe(first);
  });

  it("lights cabin windows from slot 1 and streaks the lit ones across the water", () => {
    const { lane, windows } = fakeLane();
    const sc = buildAuroraFjordScenery();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    expect(windows[0]!.emissiveIntensity).toBeGreaterThan(windows[1]!.emissiveIntensity);
    expect(windows[1]!.emissiveIntensity).toBeGreaterThan(windows[2]!.emissiveIntensity);
    expect(windows[2]!.emissiveIntensity).toBeCloseTo(0.05, 5);
    expect(sc.streakCount).toBe(2);
    const streaks = sc.root.getObjectByName("aurora-fjord-streaks") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    streaks.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    // from the shore toward the eye at (8, 40): between them, on the water
    expect(p.y).toBeCloseTo(0.05, 5);
    expect(p.x).toBeLessThan(230);
    expect(p.z).toBeGreaterThan(-250);
  });

  it("instances ripples from slot 2 within the pool and skips empty rows", () => {
    const { lane } = fakeLane();
    const sc = buildAuroraFjordScenery();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    expect(sc.rippleCount).toBe(2);
    const ripples = sc.root.getObjectByName("aurora-fjord-ripples") as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    ripples.getMatrixAt(1, m);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect(p.toArray().map((v) => Math.round(v * 100) / 100)).toEqual([210, 0.06, -300]);
    expect(s.x).toBeCloseTo(24, 5);
    slots[0]![AF_SLOT.ripples] = 99;
    sc.update((sl, i) => slots[sl]?.[i] ?? 0, DT);
    expect(sc.rippleCount).toBeLessThanOrEqual(AF_MAX_RIPPLES);
  });

  it("feeds the shared fog uniforms and the aurora light from slot 0", () => {
    const { lane, rock } = fakeLane();
    const sc = buildAuroraFjordScenery();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    const shader = mockPartial<THREE.WebGLProgramParametersWithUniforms>({
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    });
    rock.onBeforeCompile(shader, mockPartial<THREE.WebGLRenderer>({}));
    expect(shader.uniforms.uAfFog!.value).toBeCloseTo(0.3, 5);
    expect(shader.uniforms.uAfFront!.value).toBe(-900);
    expect(shader.uniforms.uAfSide!.value).toBe(1);
    expect(shader.fragmentShader).toContain("uAfSide * vAfWorld.y < -0.02");
    expect(shader.vertexShader).toContain("vAfWorld = ( modelMatrix");
    const lights = sc.root.children.filter((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight[];
    expect(lights).toHaveLength(2);
    const aurora = lights.find((l) => l.color.g > l.color.b)!;
    expect(aurora.intensity).toBeGreaterThan(0.6);
  });

  it("patches a material once", () => {
    const m = new THREE.MeshStandardMaterial();
    const shared = { uAfFog: { value: 0 }, uAfFront: { value: 0 }, uAfTime: { value: 0 }, uAfHaze: { value: new THREE.Color() } };
    patchFjordMaterial(m, shared, 1);
    const hook = m.onBeforeCompile;
    patchFjordMaterial(m, shared, -1);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.userData.auroraFjord).toEqual({ side: 1 });
  });

  it("detaches the reflection on dispose so shared GLB geometry is freed once, by the lane", () => {
    const { lane, geo } = fakeLane();
    const sc = buildAuroraFjordScenery();
    lane.add(sc.root);
    const slots = syntheticSlots();
    sc.update((s, i) => slots[s]?.[i] ?? 0, DT);
    let disposed = 0;
    geo.addEventListener("dispose", () => { disposed++; });
    disposeHostMeshObject3D(sc.root);
    expect(disposed).toBe(0);
    expect(sc.root.getObjectByName("aurora-fjord-mirror")!.children).toHaveLength(0);
    expect(sc.bound).toBe(false);
  });
});
