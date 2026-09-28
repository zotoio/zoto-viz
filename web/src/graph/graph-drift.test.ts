import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyDriftPoint,
  driftRig,
  easeCycle,
  figureEight,
  graphDriftPose,
  lagIntoLayout,
  nodeLagReach,
  nodeTravelScale,
  stepNodeLag,
  unapplyDriftPoint,
} from "./graph-drift";

const cam = { pitchDeg: 8, pitchPeriod: 16 };

describe("figureEight", () => {
  it("crosses itself and runs further in Z than in X", () => {
    const origin = figureEight(0, 0);
    const again = figureEight(Math.PI, 0);
    expect(origin.x).toBeCloseTo(0, 6);
    expect(origin.z).toBeCloseTo(0, 6);
    expect(again.x).toBeCloseTo(0, 6);
    expect(again.z).toBeCloseTo(0, 6);
    const a = figureEight(Math.PI / 4, 0);
    const b = figureEight((3 * Math.PI) / 4, 0);
    expect(a.z).toBeGreaterThan(0);
    expect(b.z).toBeLessThan(0);
    expect(Math.abs(a.z)).toBeGreaterThan(Math.abs(a.x));
  });

  it("tilts the eight off the floor", () => {
    const flat = figureEight(Math.PI / 4, 0);
    const tilted = figureEight(Math.PI / 4, 0.08);
    expect(flat.y).toBeCloseTo(0, 6);
    expect(Math.abs(tilted.y)).toBeGreaterThan(0.2);
    expect(Math.abs(tilted.z)).toBeLessThan(Math.abs(flat.z));
  });
});

describe("graphDriftPose", () => {
  it("eases, and does not share the camera pitch period", () => {
    const early = graphDriftPose(16 * 1.45 * 0.05, cam);
    const mid = graphDriftPose(16 * 1.45 * 0.25, cam);
    expect(Math.hypot(early.x, early.z)).toBeLessThan(Math.hypot(mid.x, mid.z));
    const start = graphDriftPose(0, cam);
    const atCamPeriod = graphDriftPose(cam.pitchPeriod, cam);
    expect(Math.hypot(atCamPeriod.x - start.x, atCamPeriod.z - start.z)).toBeGreaterThan(1);
  });

  it("nods at a slightly different pitch than the camera", () => {
    let peak = 0;
    const period = cam.pitchPeriod * 1.23;
    for (let i = 0; i <= 40; i++) {
      peak = Math.max(peak, Math.abs(graphDriftPose((period * i) / 40, cam).pitch));
    }
    const camPeak = (cam.pitchDeg * Math.PI) / 180;
    expect(peak).toBeGreaterThan(camPeak * 0.9);
    expect(Math.abs(peak - camPeak)).toBeGreaterThan(0.01);
  });
});

describe("easeCycle", () => {
  it("is slower at the start of a turn than at the middle", () => {
    const d0 = easeCycle(0.08) - easeCycle(0);
    const d1 = easeCycle(0.5) - easeCycle(0.42);
    expect(d0).toBeLessThan(d1);
  });
});

describe("sphere drift", () => {
  it("yaws on its own period so it does not lock to the sky sphere", () => {
    const camera = { ...cam, yawPeriod: 110 };
    const plane = graphDriftPose(40, camera, 0.2, false);
    const sphere = graphDriftPose(40, camera, 0.2, true);
    expect(plane.yaw).toBe(0);
    expect(Math.abs(sphere.yaw)).toBeGreaterThan(0.2);
    const later = graphDriftPose(40 + camera.yawPeriod, camera, 0.2, true);
    const slip = later.yaw - sphere.yaw;
    expect(Math.abs(slip % (Math.PI * 2))).toBeGreaterThan(0.2);
    expect(Math.abs(Math.abs(slip) - Math.PI * 2)).toBeGreaterThan(0.2);
  });
});

describe("node lag", () => {
  it("trails the cloud and covers less ground than the pose", () => {
    const follow = stepNodeLag({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }, 0.2);
    expect(follow.z).toBeGreaterThan(0);
    expect(follow.z).toBeLessThan(6);
    expect(20 - follow.z).toBeGreaterThan(10);
  });

  it("puts the trail back onto the rig's layout axes", () => {
    const pose = graphDriftPose(8, { ...cam, yawPeriod: 80 }, 0.2, true);
    const world = { x: 3, y: -2, z: 5 };
    const local = lagIntoLayout(world, pose);
    const origin = applyDriftPoint(0, 0, 0, pose, { x: 0, y: 0, z: 0 });
    const shifted = applyDriftPoint(local.x, local.y, local.z, pose, { x: 0, y: 0, z: 0 });
    expect(shifted.x - origin.x).toBeCloseTo(world.x, 4);
    expect(shifted.y - origin.y).toBeCloseTo(world.y, 4);
    expect(shifted.z - origin.z).toBeCloseTo(world.z, 4);
  });

  it("scales neighbouring nodes differently but keeps both slower than the cloud", () => {
    const a = nodeTravelScale("10.0.0.1");
    const b = nodeTravelScale("10.0.0.2");
    expect(a).toBeGreaterThanOrEqual(0.9);
    expect(a).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0.9);
    expect(b).toBeLessThanOrEqual(1);
    expect(nodeLagReach(10)).toBeGreaterThan(10);
    expect(nodeLagReach(10)).toBeLessThan(16);
    expect(a).not.toBeCloseTo(b, 5);
    expect(nodeTravelScale("10.0.0.1")).toBe(a);
  });
});

describe("applyDriftPoint", () => {
  it("round-trips a layout point", () => {
    const pose = graphDriftPose(9.2, cam, 0.3);
    const center = { x: 40, y: -12, z: 80 };
    const world = applyDriftPoint(120, 30, -20, pose, center);
    const back = unapplyDriftPoint(world.x, world.y, world.z, pose, center);
    expect(back.x).toBeCloseTo(120, 5);
    expect(back.y).toBeCloseTo(30, 5);
    expect(back.z).toBeCloseTo(-20, 5);
    expect(Math.hypot(world.x - 120, world.z + 20)).toBeGreaterThan(1);
  });

  it("round-trips a point on a yawed sphere", () => {
    const pose = graphDriftPose(12, { ...cam, yawPeriod: 90 }, 0.4, true);
    const center = { x: 10, y: 20, z: -30 };
    const world = applyDriftPoint(-40, 80, 50, pose, center);
    const back = unapplyDriftPoint(world.x, world.y, world.z, pose, center);
    expect(back.x).toBeCloseTo(-40, 4);
    expect(back.y).toBeCloseTo(80, 4);
    expect(back.z).toBeCloseTo(50, 4);
  });

  it("matches a yaw-then-pitch quaternion on the rig", () => {
    const pose = graphDriftPose(8, { ...cam, yawPeriod: 80 }, 0.2, true);
    const center = { x: 15, y: -8, z: 40 };
    const rig = driftRig(pose, center);
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rig.pitch);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rig.yaw);
    const q = new THREE.Quaternion().multiplyQuaternions(yaw, pitch);
    const local = new THREE.Vector3(90, 30, -20);
    const viaQuat = local.clone().applyQuaternion(q).add(new THREE.Vector3(rig.x, rig.y, rig.z));
    const viaPose = applyDriftPoint(local.x, local.y, local.z, pose, center);
    expect(viaQuat.x).toBeCloseTo(viaPose.x, 4);
    expect(viaQuat.y).toBeCloseTo(viaPose.y, 4);
    expect(viaQuat.z).toBeCloseTo(viaPose.z, 4);
  });
});
