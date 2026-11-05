import { describe, expect, it } from "vitest";
import { koiStagePose } from "./stage-mesh-camera";

describe("koiStagePose follow", () => {
  it("uses slot3 eye/aim/fov when follow is on", () => {
    const buf = new Float32Array(64);
    const read = (slot: number, i: number) => (slot === 3 ? buf[i]! : 0);
    buf[0] = 1;
    buf[1] = 0.5; buf[2] = 0.4; buf[3] = 0.9;
    buf[4] = 0.1; buf[5] = 0.05; buf[6] = 0.2;
    buf[7] = 42;
    const pose = koiStagePose(read, 16 / 9);
    expect(pose.position[0]).toBeCloseTo(0.5, 5);
    expect(pose.position[1]).toBeCloseTo(0.4, 5);
    expect(pose.position[2]).toBeCloseTo(0.9, 5);
    expect(pose.target[0]).toBeCloseTo(0.1, 5);
    expect(pose.target[1]).toBeCloseTo(0.05, 5);
    expect(pose.target[2]).toBeCloseTo(0.2, 5);
    expect(pose.fov).toBeGreaterThan(30);
  });

  it("falls back to drift pose when follow is off", () => {
    const read = (slot: number, i: number) => (slot === 0 && i === 17 ? 1 : slot === 0 && i === 18 ? 0 : 0);
    const pose = koiStagePose(read);
    expect(pose.target).toEqual([0, 0, 0]);
    expect(pose.position[1]).toBeGreaterThan(1);
  });
});
