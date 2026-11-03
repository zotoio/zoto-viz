import { describe, expect, it } from "vitest";
import { aquariumStagePose, koiStagePose, rocketCarStagePose, stageMeshPackId, stageMeshPose } from "./stage-mesh-camera";

function slots(values: Record<string, number>) {
  return (slot: number, index: number) => values[`${slot}:${index}`] ?? 0;
}

describe("stage mesh camera", () => {
  it("strips the plugin view prefix", () => {
    expect(stageMeshPackId("plugin:aquarium")).toBe("aquarium");
    expect(stageMeshPackId("plugin:koi-pond:2", "koi-pond")).toBe("koi-pond");
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
});
