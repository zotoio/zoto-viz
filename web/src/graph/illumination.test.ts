import { describe, expect, it } from "vitest";
import { illuminationPose } from "./illumination";

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
