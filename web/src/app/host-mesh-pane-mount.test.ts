import { describe, expect, it, vi } from "vitest";
import { mountPaneHostMeshes } from "./host-mesh-bridge";

/** Only the lane methods a pane mount touches; the real lane needs a WebGL scene. */
function fakeLane() {
  return {
    clear: vi.fn(),
    setAssetOrder: vi.fn(),
    ensureAssets: vi.fn(async () => {}),
    setScenery: vi.fn(),
    applySlotBuffer: vi.fn(),
  };
}

const aquarium = { id: "aquarium", assets: [{ id: "fish", path: "fish.glb" }] };

describe("mountPaneHostMeshes (a pane that is not the live view)", () => {
  it("pins the pack's scenery and fixed contents into the pane's own lane", async () => {
    const lane = fakeLane();
    await mountPaneHostMeshes(lane, aquarium, () => true);
    expect(lane.clear).toHaveBeenCalled();
    expect(lane.setAssetOrder).toHaveBeenCalledWith(["fish"]);
    expect(lane.ensureAssets).toHaveBeenCalledWith("aquarium", aquarium.assets);
    expect(lane.setScenery).toHaveBeenCalledTimes(1);
    expect(lane.applySlotBuffer).toHaveBeenCalled();
  });

  it("pins nothing when the pane was rebound while its assets loaded", async () => {
    const lane = fakeLane();
    await mountPaneHostMeshes(lane, aquarium, () => false);
    expect(lane.setScenery).not.toHaveBeenCalled();
    expect(lane.applySlotBuffer).not.toHaveBeenCalled();
    expect(lane.clear).toHaveBeenCalledTimes(2);
  });

  it("only clears when the pack has no assets, so a previous pack's meshes do not stay", async () => {
    const lane = fakeLane();
    await mountPaneHostMeshes(lane, { id: "rocket-car-soccer" }, () => true);
    expect(lane.clear).toHaveBeenCalledTimes(1);
    expect(lane.ensureAssets).not.toHaveBeenCalled();
    expect(lane.setScenery).not.toHaveBeenCalled();
  });
});
