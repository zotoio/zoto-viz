import { describe, expect, it } from "vitest";
import { tickVoxelWorld, initVoxelWorld, setVoxConfig } from "../../../plugins/src/voxel-world/frontend/engine";
import { VOX_SLOT } from "../../../plugins/src/voxel-world/frontend/slots";
import { EMPTY_SYS_TELEMETRY } from "../../../plugins/sdk/viz-contract";

describe("voxel present cadence", () => {
  it("advances camera slot sim time each tick with real dt", () => {
    initVoxelWorld();
    setVoxConfig({ preset: "classic", seed: "42" });
    const frame = {
      t: 1000,
      demo: true,
      packets: [],
      talkers: [],
      headlines: [],
      // The engine reads only cpu and failed (both 0, as before); `load` is not a contract gauge.
      sys: { ...EMPTY_SYS_TELEMETRY },
    };
    const a = tickVoxelWorld(frame, 1.6, 1 / 60).slot0.slice();
    const b = tickVoxelWorld(frame, 1.6, 1 / 60).slot0.slice();
    expect(b[VOX_SLOT.camX]).not.toBe(a[VOX_SLOT.camX]);
  });
});
