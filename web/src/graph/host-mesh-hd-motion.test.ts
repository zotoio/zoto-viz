import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyHdFishMotion,
  buildAquariumHdLights,
  FISH_BEND_MAX,
  fishTurnBend,
  HostMeshLane,
} from "./host-mesh-lane";
import { hostMeshMotionProfile } from "../app/host-mesh-bridge";

/** The designer fish rig: root mid-body, spine_01 points the chain backward (-Z), head carries the pectorals. */
function fishRig(): { root: THREE.Group; bones: Record<string, THREE.Bone> } {
  const b = (name: string) => Object.assign(new THREE.Bone(), { name });
  const bones: Record<string, THREE.Bone> = {};
  for (const n of ["root", "head", "fin_pectoral_L", "fin_pectoral_R", "spine_01", "spine_02", "spine_03", "tail_01", "tail_02"]) bones[n] = b(n);
  bones.root!.position.set(0, 0, 0.02);
  bones.root!.add(bones.head!, bones.spine_01!);
  bones.head!.add(bones.fin_pectoral_L!, bones.fin_pectoral_R!);
  bones.fin_pectoral_L!.position.set(-0.005, 0.01, 0);
  bones.fin_pectoral_R!.position.set(0.005, 0.01, 0);
  bones.spine_01!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  let prev = bones.spine_01!;
  for (const n of ["spine_02", "spine_03", "tail_01", "tail_02"]) {
    bones[n]!.position.set(0, 0.015, 0);
    prev.add(bones[n]!);
    prev = bones[n]!;
  }
  const root = new THREE.Group();
  root.add(bones.root!);
  return { root, bones };
}

function rigFor(bones: Record<string, THREE.Bone>, turnRate: number) {
  return {
    chain: ["spine_01", "spine_02", "spine_03", "tail_01", "tail_02"].map((n) => bones[n]!),
    head: bones.head!,
    finL: bones.fin_pectoral_L!,
    finR: bones.fin_pectoral_R!,
    phase: 0,
    turnRate,
    bend: fishTurnBend(turnRate),
  };
}

function tailX(turnRate: number, t = 0): number {
  const { root, bones } = fishRig();
  applyHdFishMotion(root, rigFor(bones, turnRate), t, 1 / 60);
  root.updateMatrixWorld(true);
  return bones.tail_02!.getWorldPosition(new THREE.Vector3()).x;
}

describe("aquarium HD fish motion", () => {
  it("bend is proportional to yaw rate and clamped", () => {
    expect(fishTurnBend(0)).toBe(0);
    expect(fishTurnBend(1)).toBeCloseTo(2 * fishTurnBend(0.5));
    expect(fishTurnBend(-1)).toBeCloseTo(-fishTurnBend(1));
    expect(fishTurnBend(100)).toBe(FISH_BEND_MAX);
    expect(fishTurnBend(Number.NaN)).toBe(0);
  });

  it("curls the tail toward the inside of the turn", () => {
    // Positive yaw rate swings the nose toward +X; the tail end follows the C toward +X too.
    const left = tailX(2);
    const straight = tailX(0);
    const right = tailX(-2);
    expect(left).toBeGreaterThan(straight + 0.003);
    expect(right).toBeLessThan(straight - 0.003);
  });

  it("beats the tail and pectorals over time with no turn", () => {
    const xs = [0, 0.05, 0.1, 0.15, 0.2].map((t) => tailX(0, t));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.001);
    const fin = (t: number) => {
      const { root, bones } = fishRig();
      applyHdFishMotion(root, rigFor(bones, 0), t, 1 / 60);
      return bones.fin_pectoral_L!.quaternion.clone();
    };
    expect(fin(0).angleTo(fin(0.25))).toBeGreaterThan(0.1);
  });

  it("is the aquarium HD set's only", () => {
    expect(hostMeshMotionProfile("aquarium", "hd")).toBe("aquarium-hd");
    expect(hostMeshMotionProfile("aquarium", "standard")).toBe("standard");
    expect(hostMeshMotionProfile("koi-pond", "hd")).toBe("standard");
    expect(hostMeshMotionProfile(undefined, "hd")).toBe("standard");
  });

  it("adds the brighter HD lamp only under aquarium-hd", () => {
    const lane = new HostMeshLane();
    const lights = () => lane.group.getObjectByName("AquariumHdLights");
    expect(lights()).toBeUndefined();
    lane.setMotionProfile("aquarium-hd");
    expect(lights()).toBeDefined();
    lane.setMotionProfile("standard");
    expect(lights()).toBeUndefined();
    const g = buildAquariumHdLights();
    let total = 0;
    g.traverse((o) => {
      if ((o as THREE.Light).isLight) total += (o as THREE.Light).intensity;
    });
    expect(total).toBeGreaterThan(1);
  });
});
