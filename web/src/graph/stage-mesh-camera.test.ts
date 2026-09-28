import { describe, expect, it } from "vitest";
import { aquariumStagePose, koiStagePose, stageMeshPackId, stageMeshPose } from "./stage-mesh-camera";

function slots(values: Record<string, number>) {
  return (slot: number, index: number) => values[`${slot}:${index}`] ?? 0;
}

describe("stage mesh camera", () => {
  it("strips the plugin view prefix", () => {
    expect(stageMeshPackId("plugin:aquarium")).toBe("aquarium");
    expect(stageMeshPackId("plugin:koi-pond:2", "koi-pond")).toBe("koi-pond");
  });

  it("matches the aquarium drift camera", () => {
    const pose = aquariumStagePose(slots({ "0:8": 1, "0:9": 0 }));
    expect(pose.position[0]).toBeCloseTo(0);
    expect(pose.position[2]).toBeCloseTo(2.35);
    expect(pose.target[2]).toBeCloseTo(1.35);
    expect(pose.fov).toBeUndefined();
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
    expect(stageMeshPose("aquarium", slots({}))?.position[2]).toBeCloseTo(2.55);
  });
});
