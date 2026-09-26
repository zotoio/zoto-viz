import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/voxel-world/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/voxel-world/frontend/index.ts?raw";
import VIS from "../../../plugins/src/voxel-world/visualisation.yml?raw";
import {
  VOX_DEFAULTS,
  VOX_MAX_MOBS,
  VOX_MAX_VIEW,
  VOX_PRESETS,
  VOX_SLOT,
  VOX_SLOT0_FLOATS,
  VOX_SLOT1_FLOATS,
  applyVoxelPreset,
  enforceVoxelCaps,
  parseVoxelWorldOptions,
  randomiseVoxelWorldOptions,
  releaseVoxelGpu,
  resetVoxelWorldOptions,
  setVoxelWorldOptions,
  trackVoxelGpuAlloc,
  undoVoxelWorldOptions,
  voxelWorldOptions,
  voxelGpuAllocCount,
  voxelRenderScale,
  voxelSlots,
  voxelSmokeCenterLuma,
} from "../../../plugins/src/voxel-world/frontend/world";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";

describe("voxel world shipped pack", () => {
  it("wraps and compiles the director-driven sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toContain("float terrainH(");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("leaves the drive buffer to the host", () => {
    expect(FRONT).not.toMatch(/writeBuffer\s*\(/);
  });

  it("fits the plugin buffer contract", () => {
    setVoxelWorldOptions(VOX_DEFAULTS);
    const s = voxelSlots(8.5, 1.6, false, 0.1);
    expect(s.slot0).toHaveLength(VOX_SLOT0_FLOATS);
    expect(s.slot1).toHaveLength(VOX_SLOT1_FLOATS);
    expect(s.slot0.length).toBeLessThanOrEqual(64);
    expect(s.slot1.length).toBeLessThanOrEqual(64);
    expect(s.slot0[VOX_SLOT.mark]).toBe(1);
    for (const v of [...s.slot0, ...s.slot1]) expect(Number.isFinite(v)).toBe(true);
    expect(s.slot0[VOX_SLOT.viewDist]!).toBeLessThanOrEqual(VOX_MAX_VIEW);
  });

  it("validates every shipped preset against config keys", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    for (const name of Object.keys(VOX_PRESETS)) {
      const parsed = parseVoxelWorldOptions({ preset: name });
      expect(parsed.preset).toBe(name === "custom" ? "custom" : name);
      expect(parsed.viewDist).toBeLessThanOrEqual(VOX_MAX_VIEW);
      expect(parsed.mobs).toBeLessThanOrEqual(VOX_MAX_MOBS);
    }
  });

  it("clamps caps and keeps smoke luma above near-black", () => {
    const wild = enforceVoxelCaps(parseVoxelWorldOptions({
      viewDist: "999",
      mobs: "99",
      cameraSpeed: "9",
    }));
    expect(wild.viewDist).toBe(VOX_MAX_VIEW);
    expect(wild.mobs).toBe(VOX_MAX_MOBS);
    expect(wild.cameraSpeed).toBe(2.5);
    expect(voxelSmokeCenterLuma(0)).toBeGreaterThan(0.12);
    expect(voxelRenderScale()).toBe(1);
  });

  it("randomise, undo, and reset options", () => {
    resetVoxelWorldOptions();
    const before = voxelWorldOptions().seed;
    randomiseVoxelWorldOptions(() => 0.42);
    expect(voxelWorldOptions().seed).not.toBe(before);
    undoVoxelWorldOptions();
    expect(voxelWorldOptions().seed).toBe(before);
    applyVoxelPreset("desert");
    expect(parseVoxelWorldOptions({ preset: "desert" }).biome).toBe("arid");
    resetVoxelWorldOptions();
    expect(parseVoxelWorldOptions({}).preset).toBe("classic");
  });

  it("releases tracked gpu allocations on teardown", () => {
    trackVoxelGpuAlloc(3);
    expect(voxelGpuAllocCount()).toBe(3);
    releaseVoxelGpu();
    expect(voxelGpuAllocCount()).toBe(0);
  });
});
