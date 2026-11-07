import { describe, expect, it } from "vitest";

import { FOLLOW, FollowCam, newFollowView, smoothstep01, springStep, type FollowView } from "./follow-cam";

const DT = 1 / 60;

function view(fish: [string, number, number, number, number][]): FollowView {
  const v = newFollowView(16);
  fish.forEach(([id, x, y, z, yaw], i) => {
    v.ids[i] = id; v.x[i] = x; v.y[i] = y; v.z[i] = z; v.yaw[i] = yaw;
  });
  v.count = fish.length;
  return v;
}

function run(cam: FollowCam, v: FollowView, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.(i * DT);
    cam.step(v, DT);
  }
}

describe("follow cam spring", () => {
  it("critically damped spring settles without overshoot", () => {
    const out = new Float64Array(2);
    let x = 0, v = 0, max = 0;
    for (let i = 0; i < 600; i++) {
      springStep(x, v, 1, FOLLOW.omega, DT, out);
      x = out[0]!; v = out[1]!;
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(1, 3);
    expect(max).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("smoothstep eases in and out", () => {
    expect(smoothstep01(0)).toBe(0);
    expect(smoothstep01(1)).toBe(1);
    expect(smoothstep01(0.5)).toBeCloseTo(0.5);
    expect(smoothstep01(0.1)).toBeLessThan(0.1);
  });
});

describe("follow cam handoff", () => {
  it("starts on the fish nearest the middle and drifts alongside it", () => {
    const cam = new FollowCam();
    const v = view([["a", 0.8, 0.2, -0.5, 0], ["b", 0.05, 0.0, 0.0, Math.PI / 2]]);
    run(cam, v, 3);
    expect(cam.targetId).toBe("b");
    const dx = cam.eye[0]! - v.x[1]!, dz = cam.eye[2]! - v.z[1]!;
    const d = Math.hypot(dx, dz);
    expect(d).toBeGreaterThan(0.35);
    // Pond follow stands further back/side than aquarium.
    expect(d).toBeLessThan(1.15);
    // the aim leads the fish along its heading (+x here)
    expect(cam.aim[0]!).toBeGreaterThan(v.x[1]!);
  });

  it("holds the fish for the minimum dwell even when another passes close", () => {
    const cam = new FollowCam();
    const v = view([["a", 0, 0, 0, 0], ["b", 0.1, 0, 0, Math.PI]]);
    run(cam, v, FOLLOW.minDwell * 0.8);
    expect(cam.targetId).toBe("a");
    expect(cam.nextId).toBeNull();
  });

  it("eases to a passing fish (blended, no snap) and then follows it", () => {
    const cam = new FollowCam();
    const v = view([["a", 0, 0, 0, 0], ["b", 0.9, 0.3, -0.6, Math.PI]]);
    run(cam, v, FOLLOW.minDwell + 0.5);
    expect(cam.targetId).toBe("a");
    // b swims past within the threshold
    v.x[1] = 0.12; v.y[1] = 0.02; v.z[1] = 0.05;
    cam.step(v, DT);
    expect(cam.nextId).toBe("b");
    // b moves away again; the handoff continues and the focus moves smoothly
    v.x[1] = 0.6; v.z[1] = -0.3;
    let lastFx = cam.focus[0]!;
    let maxJump = 0;
    let lastEye = cam.eye[0]!;
    let maxEyeJump = 0;
    run(cam, v, FOLLOW.blendS + 0.2, () => {
      maxJump = Math.max(maxJump, Math.abs(cam.focus[0]! - lastFx));
      maxEyeJump = Math.max(maxEyeJump, Math.abs(cam.eye[0]! - lastEye));
      lastFx = cam.focus[0]!;
      lastEye = cam.eye[0]!;
    });
    expect(cam.targetId).toBe("b");
    expect(cam.nextId).toBeNull();
    expect(cam.focus[0]!).toBeCloseTo(0.6, 5);
    // 0.6 m over 2.4 s with smoothstep: peak ~0.375 m/s → < 1 cm per frame
    expect(maxJump).toBeLessThan(0.01);
    expect(maxEyeJump).toBeLessThan(0.01);
  });

  it("does not ping-pong straight back to the previous fish", () => {
    const cam = new FollowCam();
    const v = view([["a", 0, 0, 0, 0], ["b", 0.1, 0, 0, 0]]);
    run(cam, v, FOLLOW.minDwell + 0.1);
    expect(cam.nextId).toBe("b");
    run(cam, v, FOLLOW.blendS + 0.1);
    expect(cam.targetId).toBe("b");
    // a is still right beside b: the dwell timer restarted, so no handoff yet
    run(cam, v, FOLLOW.minDwell * 0.9);
    expect(cam.targetId).toBe("b");
    expect(cam.nextId).toBeNull();
  });

  it("hands over from where a lost fish was last seen", () => {
    const cam = new FollowCam();
    const v = view([["a", 0, 0, 0, 0], ["b", 0.5, 0, -0.4, 0], ["c", -0.9, 0.4, -0.8, 0]]);
    run(cam, v, 2);
    expect(cam.targetId).toBe("a");
    const fx = cam.focus[0]!;
    // a is eaten: only b and c remain
    const w = view([["b", 0.5, 0, -0.4, 0], ["c", -0.9, 0.4, -0.8, 0]]);
    cam.step(w, DT);
    expect(cam.nextId).toBe("b");
    expect(Math.abs(cam.focus[0]! - fx)).toBeLessThan(0.01);
    run(cam, w, FOLLOW.blendS + 0.1);
    expect(cam.targetId).toBe("b");
  });

  it("keeps the eye inside the pond follow box", () => {
    const cam = new FollowCam();
    const v = view([["a", 1.1, 0.7, -0.95, Math.PI / 2]]);
    run(cam, v, 6);
    expect(cam.eye[0]!).toBeLessThanOrEqual(1.4 + 1e-6);
    expect(cam.eye[1]!).toBeLessThanOrEqual(1.8 + 1e-6);
    expect(cam.eye[1]!).toBeGreaterThanOrEqual(0.15 - 1e-6);
    expect(cam.eye[2]!).toBeGreaterThanOrEqual(-1.4 - 1e-6);
  });
});
