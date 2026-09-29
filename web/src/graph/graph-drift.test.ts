import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyDriftPoint,
  BEAT_CORE_OMEGA,
  CORE_OMEGA,
  driftOmegas,
  driftRig,
  easeCycle,
  figureEight,
  driftInView,
  graphDriftPose,
  lagIntoLayout,
  edgeSpringTarget,
  nodeLagReach,
  nodeTravelScale,
  pickDragCore,
  angularAccelAt,
  edgeAngularPull,
  edgeBowPull,
  edgeDragAccel,
  edgeDragWeight,
  edgeFlex,
  edgeGravityPerLength,
  edgeInertiaTarget,
  edgeYieldOmega,
  rigOmega,
  stepAngles,
  stepSpring,
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
  it("moves off the crossing and does not share the camera pitch period", () => {
    const early = graphDriftPose(16 * 1.45 * 0.02, cam);
    const mid = graphDriftPose(16 * 1.45 * 0.125, cam);
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
  it("keeps a steady rate through the lap so the eight does not halt", () => {
    const d0 = easeCycle(0.02) - easeCycle(0);
    const d1 = easeCycle(1.02) - easeCycle(1);
    expect(d0).toBeCloseTo(0.02, 6);
    expect(d1).toBeCloseTo(d0, 6);
    const before = figureEight(easeCycle(0.99) * Math.PI * 2, 0);
    const after = figureEight(easeCycle(1.01) * Math.PI * 2, 0);
    expect(Math.hypot(before.x, before.z)).toBeGreaterThan(1);
    expect(Math.hypot(after.x, after.z)).toBeGreaterThan(1);
  });
});

describe("driftInView", () => {
  it("keeps a screen-right slide on the camera's right as the view yaws", () => {
    const local = { x: 10, y: 2, z: 0, pitch: 0.1, yaw: 0.4 };
    const ahead = driftInView(local, 0);
    expect(ahead.x).toBeCloseTo(10, 5);
    expect(ahead.y).toBeCloseTo(2, 5);
    expect(ahead.z).toBeCloseTo(0, 5);
    expect(ahead.pitch).toBe(local.pitch);
    expect(ahead.yaw).toBe(local.yaw);
    const side = driftInView(local, Math.PI / 2);
    expect(side.x).toBeCloseTo(0, 5);
    expect(side.z).toBeCloseTo(-10, 5);
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
  it("accelerates from rest and stays behind the target", () => {
    const rest = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    const target = { x: 0, y: 0, z: 20 };
    const first = stepSpring(rest, target, 0.2, 1.2);
    expect(first.z).toBeGreaterThan(0);
    expect(first.z).toBeLessThan(6);
    expect(20 - first.z).toBeGreaterThan(10);
    expect(first.vz).toBeGreaterThan(0);
    const second = stepSpring(first, target, 0.2, 1.2);
    expect(second.z).toBeGreaterThan(first.z);
    expect(second.z).toBeLessThan(20);
    let body = second;
    let prev = second.z;
    for (let i = 0; i < 90; i++) {
      body = stepSpring(body, target, 1 / 30, 1.2);
      expect(body.z).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(body.z).toBeLessThanOrEqual(20 + 1e-4);
      prev = body.z;
    }
    expect(body.z).toBeGreaterThan(12);
  });

  it("leaves the edge middle behind a core that is moving away", () => {
    let core = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let node = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let edge = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 1; i <= 90; i++) {
      const goal = { x: 0, y: 0, z: i * 0.45 };
      core = stepSpring(core, goal, 1 / 30, 2.2);
      node = stepSpring(node, core, 1 / 30, 0.85);
      edge = stepSpring(edge, edgeSpringTarget(core, node), 1 / 30, 0.42);
    }
    expect(node.z).toBeLessThan(core.z - 0.5);
    expect(edge.z).toBeLessThan(node.z - 0.5);
  });

  it("eases more gently than the mic-beat springs", () => {
    const eased = driftOmegas(false);
    const beat = driftOmegas(true);
    expect(eased.core).toBe(CORE_OMEGA);
    expect(beat.core).toBe(BEAT_CORE_OMEGA);
    expect(eased.core).toBeLessThan(beat.core);
    expect(eased.node).toBeLessThan(beat.node);
    expect(eased.edge).toBeLessThan(beat.edge);
    const goal = { x: 0, y: 0, z: 24 };
    let soft = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let hard = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 20; i++) {
      soft = stepSpring(soft, goal, 1 / 30, eased.core);
      hard = stepSpring(hard, goal, 1 / 30, beat.core);
    }
    expect(soft.z).toBeGreaterThan(0);
    expect(soft.z).toBeLessThan(hard.z);
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

describe("whole-cloud turn", () => {
  it("eases pitch and yaw instead of taking the target angle", () => {
    const turned = stepAngles(0, 0, 0, 0, 0.4, 1.2, 0.05, CORE_OMEGA);
    expect(Math.abs(turned.pitch)).toBeLessThan(0.12);
    expect(Math.abs(turned.yaw)).toBeLessThan(0.2);
    expect(turned.pitchV).not.toBe(0);
    expect(turned.yawV).not.toBe(0);
    let pitch = 0, pitchV = 0, yaw = 0, yawV = 0;
    for (let i = 0; i < 180; i++) {
      const next = stepAngles(pitch, pitchV, yaw, yawV, 0.4, 1.2, 1 / 30, CORE_OMEGA);
      expect(Math.abs(next.pitch - pitch)).toBeLessThan(0.08);
      expect(Math.abs(next.yaw - yaw)).toBeLessThan(0.12);
      pitch = next.pitch;
      pitchV = next.pitchV;
      yaw = next.yaw;
      yawV = next.yawV;
    }
    expect(pitch).toBeGreaterThan(0.3);
    expect(pitch).toBeLessThan(0.42);
    expect(yaw).toBeGreaterThan(1);
    expect(yaw).toBeLessThan(1.22);
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

describe("drag core", () => {
  it("uses the graph origin when nodes are a similar size", () => {
    const core = pickDragCore([
      { x: 0, y: 0, z: 0, scale: 4 },
      { x: 30, y: 0, z: 0, scale: 5 },
      { x: 0, y: 0, z: 30, scale: 4.5 },
    ]);
    expect(core.x).toBeCloseTo(10, 4);
    expect(core.y).toBeCloseTo(0, 4);
    expect(core.z).toBeCloseTo(10, 4);
  });

  it("uses the largest node when it clearly leads", () => {
    const core = pickDragCore([
      { x: 0, y: 0, z: 0, scale: 4 },
      { x: 40, y: 8, z: -12, scale: 9 },
      { x: 10, y: 0, z: 10, scale: 5 },
    ]);
    expect(core).toEqual({ x: 40, y: 8, z: -12 });
  });

  it("keeps edges quiet at the core and bows them opposite the acceleration", () => {
    expect(edgeDragWeight({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0);
    expect(edgeDragWeight({ x: 80, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeCloseTo(1, 4);
    const coast = edgeDragAccel({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4 * 0.02, y: 0, z: 0 }, 0.02);
    expect(coast.accel.x).toBeCloseTo(0, 4);
    const speeding = edgeDragAccel({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 0.5);
    expect(speeding.accel.x).toBeGreaterThan(0);
    const sag = edgeInertiaTarget(speeding.accel);
    expect(sag.x).toBeLessThan(0);
    expect(Math.hypot(sag.x, sag.y, sag.z)).toBeLessThanOrEqual(12 + 1e-6);
    let body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < 40; i++) body = stepSpring(body, sag, 0.05, 1.55);
    expect(body.x).toBeLessThan(-1);
    const bow = edgeBowPull(body, 1, 4);
    expect(Math.hypot(bow.x, bow.y, bow.z)).toBeLessThanOrEqual(4 * 0.45 + 1e-6);
  });

  it("keeps a stiff edge straight and lets a slack edge hang and lag the spin", () => {
    expect(edgeFlex(0, 1.6)).toBe(0);
    expect(edgeFlex(1, 0, 1)).toBeGreaterThan(edgeFlex(1, 2, 1));
    expect(edgeYieldOmega(0)).toBeGreaterThan(edgeYieldOmega(1));
    const down = edgeGravityPerLength({ x: 0, y: -1, z: 0 }, 1, 1);
    expect(down.y).toBeLessThan(-0.1);
    expect(edgeGravityPerLength({ x: 0, y: -1, z: 0 }, 0, 1).y).toBeCloseTo(0, 6);
    const level = rigOmega(0, 0.2, 0.4);
    expect(level.x).toBeCloseTo(0.2, 5);
    expect(level.y).toBeCloseTo(0.4, 5);
    const spun = angularAccelAt({ x: 80, y: 0, z: 0 }, { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(spun.x).toBeLessThan(0);
    const whip = edgeAngularPull(
      { x: 80, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 0.4, y: 0, z: 0 },
      1,
      40,
    );
    expect(Math.hypot(whip.x, whip.y, whip.z)).toBeGreaterThan(1);
    const rod = edgeAngularPull(
      { x: 80, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 0.4, y: 0, z: 0 },
      0,
      40,
    );
    expect(rod).toEqual({ x: 0, y: 0, z: 0 });
  });
});
