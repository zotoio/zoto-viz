import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GraphIllumination, illuminationPose } from "./illumination";

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe("illuminationPose", () => {
  it("keeps the key above the graph and the bounce underneath", () => {
    for (let t = 0; t <= 40; t += 0.5) {
      const p = illuminationPose(t);
      expect(p.key.y).toBeGreaterThan(180);
      expect(p.bounce.y).toBeLessThan(-200);
    }
  });

  it("moves every source smoothly and keeps them apart", () => {
    let prev = illuminationPose(0);
    let apart = 0;
    for (let t = 0.2; t <= 12; t += 0.2) {
      const next = illuminationPose(t);
      for (const k of ["key", "fill", "bounce", "warm", "cool"] as const) {
        expect(dist(prev[k], next[k])).toBeLessThan(40);
        expect(Math.hypot(next[k].x, next[k].y, next[k].z)).toBeLessThan(700);
      }
      apart = Math.max(apart, dist(next.warm, next.cool), dist(next.key, next.fill));
      prev = next;
    }
    expect(apart).toBeGreaterThan(80);
    expect(dist(illuminationPose(0).key, illuminationPose(8).key)).toBeGreaterThan(40);
  });
});

describe("GraphIllumination", () => {
  it("hides and restores the whole rig", () => {
    const scene = new THREE.Scene();
    const rig = new GraphIllumination(scene, 0x7eb8ff);
    const lights = scene.children.filter((c) => (c as THREE.Light).isLight);
    expect(lights).toHaveLength(6);
    rig.setEnabled(false);
    expect(lights.every((l) => !l.visible)).toBe(true);
    rig.setEnabled(true);
    expect(lights.every((l) => l.visible)).toBe(true);
  });
});
