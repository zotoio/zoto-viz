import { describe, expect, it } from "vitest";
import { aquariumStagePose, auroraFjordStagePose, koiStagePose, orreryStagePose, rocketCarStagePose, stageMeshPackId, stageMeshPose } from "./stage-mesh-camera";

function slots(values: Record<string, number>) {
  return (slot: number, index: number) => values[`${slot}:${index}`] ?? 0;
}

describe("stage mesh camera", () => {
  it("strips the plugin view prefix", () => {
    expect(stageMeshPackId("plugin:aquarium")).toBe("aquarium");
    expect(stageMeshPackId("plugin:koi-pond:2", "koi-pond")).toBe("koi-pond");
  });

  it("uses the view's own aspect over the pack canvas guess (maximised / narrow panes)", () => {
    for (const aspect of [0.6, 1, 2.7, 3.5]) {
      const pose = aquariumStagePose(slots({ "0:8": 2, "0:12": 1280, "0:13": 800 }), aspect);
      const t = Math.tan(((pose.fov ?? 0) * Math.PI) / 360);
      const d = pose.position[2] - 1.02;
      expect(0.82).toBeLessThan(d * t);
      expect(1.22).toBeLessThan(d * t * aspect);
    }
  });

  it("frames the whole tank front at the pane aspect", () => {
    for (const [w, h] of [[1400, 820], [800, 800], [1920, 600], [0, 0]]) {
      const pose = aquariumStagePose(slots({ "0:8": 2, "0:12": w!, "0:13": h! }));
      const aspect = w && h ? w / h : 1.6;
      const t = Math.tan(((pose.fov ?? 0) * Math.PI) / 360);
      const d = pose.position[2] - 1.02;
      // front glass corners (±1.22, ±0.82) project inside the frame
      expect(0.82 + Math.abs(pose.position[1])).toBeLessThan(d * t);
      expect(1.22 + Math.abs(pose.position[0])).toBeLessThan(d * t * aspect);
      expect(pose.target[2]).toBeCloseTo(pose.position[2] - 1);
    }
  });

  it("koi follow: slot3 follow on {0,1} only, not host-mesh v2 header on slot3 (legacy slot3 mesh + new slot4 mesh)", () => {
    const meshOn3 = slots({ "3:0": 2, "3:1": 99, "0:17": 1, "0:18": 0.2 });
    const drift = koiStagePose(meshOn3);
    expect(drift.target).toEqual([0, 0, 0]);
    const follow = koiStagePose(slots({ "3:0": 1, "3:1": 0.4, "3:2": 0.5, "3:3": 1.1, "3:4": 0, "3:5": 0, "3:6": 0.2, "3:7": 44 }));
    expect(follow.position[0]).toBeCloseTo(0.4, 5);
    expect(follow.fov).toBeCloseTo(44, 1);
  });

  it("pulls the koi camera down onto the pond", () => {
    const pose = koiStagePose(slots({ "0:17": 0, "0:18": 0 }));
    expect(pose.position[1]).toBeCloseTo(1.37);
    expect(pose.target).toEqual([0, 0, 0]);
    expect(pose.fov).toBeGreaterThan(40);
    expect(pose.fov).toBeLessThan(50);
  });

  it("only poses the fish packs", () => {
    expect(stageMeshPose("topology", slots({}))).toBeNull();
    expect(stageMeshPose("aquarium", slots({}))?.position[2]).toBeGreaterThan(3);
  });

  it("puts the stage camera in the rocket-car arena camera", () => {
    const pose = rocketCarStagePose(slots({ "0:0": 1, "0:1": 3, "0:2": 8, "0:3": -10, "0:4": 0, "0:5": -0.4 }));
    expect(pose.position).toEqual([3, 8, -10]);
    expect(pose.target[0]).toBeCloseTo(3);
    expect(pose.target[1]).toBeCloseTo(8 + Math.sin(-0.4));
    expect(pose.target[2]).toBeCloseTo(-10 + Math.cos(-0.4));
    expect(Math.hypot(...pose.position)).toBeLessThan(100);
  });

  it("uses the shader kickoff camera before the first rocket-car tick", () => {
    const pose = stageMeshPose("rocket-car-soccer", slots({}));
    expect(pose?.position).toEqual([0, 11, 26]);
    expect(pose?.target[2]).toBeLessThan(26);
  });

  it("orrery: follows the pack camera (slot0 1..7) and keeps the machine in narrow panes", () => {
    const cam = slots({ "0:0": 1, "0:1": 0, "0:2": 0.75, "0:3": 1.23, "0:4": 0, "0:5": 0.2, "0:6": 0, "0:7": 30 });
    const pose = stageMeshPose("orrery", cam, 32 / 9);
    expect(pose?.position).toEqual([0, 0.75, 1.23]);
    expect(pose?.fov).toBeCloseTo(30, 3);
    const tall = orreryStagePose(cam, 0.6);
    const t = Math.tan(((tall.fov ?? 0) * Math.PI) / 360);
    expect(tall.fov!).toBeGreaterThan(30);
    expect(0.56).toBeLessThanOrEqual(Math.hypot(0.55, 1.23) * t * 0.6 + 1e-9);
  });

  it("orrery: desk-level rest pose before the pack's first frame", () => {
    const rest = orreryStagePose(slots({}), 2);
    expect(rest.target).toEqual([0, 0.2, 0]);
    expect(rest.fov).toBe(30);
  });
  it("aurora-fjord: follows the pack camera (slot0 1..7) and widens on narrow panes", () => {
    const cam = slots({ "0:0": 1, "0:1": 6, "0:2": 15, "0:3": 40, "0:4": -4, "0:5": 90, "0:6": -800, "0:7": 34 });
    const pose = stageMeshPose("aurora-fjord", cam, 32 / 9);
    expect(pose?.position).toEqual([6, 15, 40]);
    expect(pose?.target).toEqual([-4, 90, -800]);
    expect(pose?.fov).toBeCloseTo(34, 3);
    expect(pose?.near).toBe(0.5);
    const square = auroraFjordStagePose(cam, 1);
    const half = Math.atan(Math.tan(((square.fov ?? 0) * Math.PI) / 360) * 1);
    expect(square.fov!).toBeGreaterThan(34);
    expect((half * 180) / Math.PI).toBeGreaterThanOrEqual(28 - 1e-6);
    expect(auroraFjordStagePose(cam, 0.2).fov).toBeLessThanOrEqual(75);
  });

  it("aurora-fjord: rest pose down the fjord before the pack's first frame", () => {
    const rest = auroraFjordStagePose(slots({}), 32 / 9);
    expect(rest.position).toEqual([8, 14, 40]);
    expect(rest.target[2]).toBeLessThan(-500);
    expect(rest.fov).toBe(34);
  });
});
