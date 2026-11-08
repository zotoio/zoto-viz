import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { AQUARIUM_MAX_FISH, buildAquariumScenery, fishTemplateName } from "./aquarium-scenery";
import { aquariumStagePose } from "./stage-mesh-camera";
import { pinPackContents } from "../app/host-mesh-bridge";
import { mockPartial } from "../../test-support/mock-partial";

/** A stand-in for the pinned scape GLB: substrate, a fresh and a reef part, two fish templates. */
function fakeLane(): THREE.Group {
  const lane = new THREE.Group();
  const scape = new THREE.Group();
  const mat = () => new THREE.MeshStandardMaterial();
  const sub = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat());
  sub.name = "substrate";
  const fresh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), mat());
  fresh.name = "fresh-plant-vallisneria";
  const reef = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat());
  reef.name = "reef-coral-brain";
  scape.add(sub, fresh, reef);
  for (const name of ["neon", "angel"]) {
    const t = new THREE.Group();
    t.name = `fish-${name}`;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.08), mat());
    body.name = `${name}-body`;
    const fins = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.03), mat());
    fins.name = `${name}-fins`;
    t.add(body, fins);
    scape.add(t);
  }
  lane.add(scape);
  return lane;
}

function slots(fish: { species: number; x: number; y: number; z: number; yaw: number }[], reef = false) {
  const s = [new Float32Array(64), new Float32Array(64), new Float32Array(64), new Float32Array(64)];
  s[0]![0] = reef ? 1 : 0;
  s[0]![7] = 1; // bubbles
  s[0]![17] = fish.length;
  fish.forEach((f, i) => {
    s[0]![26 + i] = f.species;
    s[0]![42 + i] = 0.5;
    s[1]!.set([f.x, f.y, f.z, f.yaw], i * 4);
    s[3]![16 + i] = 1 + i;
    s[3]![48 + i] = 1;
  });
  return (slot: number, index: number) => s[slot]![index] ?? 0;
}

describe("aquarium scenery", () => {
  it("maps species to the Blender templates (fresh and reef)", () => {
    expect(fishTemplateName(0, false)).toBe("neon");
    expect(fishTemplateName(1, false)).toBe("angel");
    expect(fishTemplateName(0, true)).toBe("clown");
    expect(fishTemplateName(5, true)).toBe("gramma");
    expect(fishTemplateName(99, false)).toBe("betta");
  });

  it("instances fish from slots, hides the templates and switches fresh / reef parts", () => {
    const lane = fakeLane();
    const sc = buildAquariumScenery();
    lane.add(sc.root);
    const fish = [
      { species: 0, x: 0.1, y: 0, z: 0, yaw: 0 },
      { species: 0, x: -0.3, y: 0.2, z: 0.1, yaw: 1 },
      { species: 1, x: 0.5, y: -0.1, z: -0.2, yaw: 2 },
    ];
    sc.update(slots(fish), 1 / 60);
    expect(sc.ready).toBe(true);
    expect(sc.fishDrawn).toBe(3);
    expect(lane.getObjectByName("fish-neon")!.visible).toBe(false);
    const neon = sc.root.getObjectByName("aq-fish-neon") as THREE.InstancedMesh;
    expect(neon.count).toBe(2);
    expect(neon.visible).toBe(true);
    const m = new THREE.Matrix4();
    neon.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(-0.3);
    expect(neon.geometry.getAttribute("aSwim").getX(1)).toBeCloseTo(2);
    expect(lane.getObjectByName("fresh-plant-vallisneria")!.visible).toBe(true);
    expect(lane.getObjectByName("reef-coral-brain")!.visible).toBe(false);
    sc.update(slots([], true), 1 / 60);
    expect(sc.fishDrawn).toBe(0);
    expect(neon.visible).toBe(false);
    expect(lane.getObjectByName("reef-coral-brain")!.visible).toBe(true);
  });

  it("reuses its instance buffers across frames and caps the school", () => {
    const lane = fakeLane();
    const sc = buildAquariumScenery();
    lane.add(sc.root);
    const many = Array.from({ length: 40 }, (_, i) => ({ species: 0, x: i * 0.01, y: 0, z: 0, yaw: 0 }));
    const read = slots(many.slice(0, 16));
    sc.update(read, 1 / 60);
    const neon = sc.root.getObjectByName("aq-fish-neon") as THREE.InstancedMesh;
    const arr = neon.instanceMatrix.array;
    for (let i = 0; i < 30; i++) sc.update(read, 1 / 60);
    expect(neon.instanceMatrix.array).toBe(arr);
    expect(sc.fishDrawn).toBe(AQUARIUM_MAX_FISH);
  });

  it("pins the scape GLB at the origin with the scenery", () => {
    const calls: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => calls.push(Array.from(d)), setScenery: (r) => { scenery = r; } }, "aquarium");
    expect(calls.length).toBe(1);
    expect(scenery!.name).toBe("aquarium-scenery");
  });
});

describe("aquarium follow camera pose", () => {
  it("uses the pack's follow camera from slot3 when on, else the tank framing", () => {
    const s3 = new Float32Array(64);
    const read = (slot: number, i: number) => (slot === 3 ? s3[i]! : slot === 0 && i === 12 ? 1600 : slot === 0 && i === 13 ? 900 : 0);
    const wide = aquariumStagePose(read, 16 / 9);
    expect(wide.position[2]).toBeGreaterThan(2);
    s3.set([1, 0.2, 0.1, 0.6, 0.3, 0.05, 0.2, 46]);
    const pose = aquariumStagePose(read, 16 / 9);
    expect(pose.position).toEqual([s3[1], s3[2], s3[3]]);
    expect(pose.target).toEqual([s3[4], s3[5], s3[6]]);
    expect(pose.fov).toBeCloseTo(46);
    expect(aquariumStagePose(read, 0.5).fov!).toBeGreaterThan(46);
  });
});

describe("fish skin and fins", () => {
  const one = (m: THREE.InstancedMesh): THREE.Material => (Array.isArray(m.material) ? m.material[0]! : m.material);

  /** Run a material's onBeforeCompile on three's own standard shader source and return the result. */
  function compiled(mat: THREE.Material): { vertex: string; fragment: string; uniforms: Record<string, THREE.IUniform> } {
    const lib = THREE.ShaderLib.physical;
    const shader = mockPartial<THREE.WebGLProgramParametersWithUniforms>({
      vertexShader: lib.vertexShader,
      fragmentShader: lib.fragmentShader,
      uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    });
    mat.onBeforeCompile(shader, mockPartial<THREE.WebGLRenderer>({}));
    return { vertex: shader.vertexShader, fragment: shader.fragmentShader, uniforms: shader.uniforms };
  }

  function fishParts(): { body: THREE.InstancedMesh; fins: THREE.InstancedMesh; tick: () => void } {
    const lane = fakeLane();
    const sc = buildAquariumScenery();
    lane.add(sc.root);
    sc.update(slots([{ species: 0, x: 0, y: 0, z: 0, yaw: 0 }]), 1 / 60);
    const parts: THREE.InstancedMesh[] = [];
    sc.root.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === "aq-fish-neon") parts.push(o); });
    return {
      body: parts.find((m) => m.renderOrder === 2)!,
      fins: parts.find((m) => m.renderOrder === 3)!,
      tick: () => sc.update(slots([{ species: 0, x: 0, y: 0, z: 0, yaw: 0 }]), 0.5),
    };
  }

  it("draws scales and fin rays as seamless relief that fades out when it gets too small to resolve", () => {
    const { body, fins } = fishParts();
    for (const m of [body, fins]) {
      const { fragment } = compiled(one(m));
      // the old seam pattern (fract of the scale grid) sparkled and shimmered on small fish
      expect(fragment).not.toContain("fract(vec2(aqU * 70.0");
      expect(fragment).toContain("fwidth(");
    }
  });

  it("moves fin edges with the water: thrust, a trailing lag, a turn sweep, on the tank clock", () => {
    const { body, fins, tick } = fishParts();
    const f = compiled(one(fins));
    expect(f.vertex).toContain("float thrust =");
    expect(f.vertex).toContain("float trail =");
    expect(f.vertex).toContain("float sweep = -aSwim.z");
    const clock = f.uniforms.uAqTime!;
    const before = Number(clock.value);
    tick();
    expect(Number(clock.value)).toBeGreaterThan(before);
    // the body shares the program text but its uFin is 0, so the fin block never moves body skin
    expect(compiled(one(body)).uniforms.uFin!.value).toBe(0);
    expect(f.uniforms.uFin!.value).toBe(1);
  });
});
