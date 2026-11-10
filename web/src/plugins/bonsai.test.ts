import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/bonsai/sky/fragment.glsl?raw";
import PLUGIN from "../../../plugins/src/bonsai/plugin.yml?raw";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { hostMeshDeclsForSet, hostMeshEnvironmentDecl } from "../app/host-mesh-bridge";
import { parseVizContract } from "./viz-host";

describe("bonsai pack on the host", () => {
  it("validates plugin.yml viz contract and the sky", () => {
    const contract = parseVizContract({
      graphWalk: false, maxBuffers: 6, maxBufferFloats: 64, maxParticles: 0,
      uniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"],
      idle: { fixture: "host" }, hostMeshSlot: 7, hostMeshSlotCount: 1,
    });
    expect(contract?.hostMeshSlot).toBe(7);
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if (!("error" in wrapped)) expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("swaps both GLBs to -hd for the HD set and lights HD from the environment image only", () => {
    const decls = [
      ...["bonsai-base", "bonsai-tree", "bonsai-base-hd", "bonsai-tree-hd"].map((id) => ({ id, path: `assets/${id}.glb` })),
      { id: "env-hd", path: "assets/env-hd.jpg", role: "environment" },
    ];
    expect(hostMeshDeclsForSet(decls, "standard").map((d) => d.path)).toEqual(["assets/bonsai-base.glb", "assets/bonsai-tree.glb"]);
    const hd = hostMeshDeclsForSet(decls, "hd");
    expect(hd.map((d) => d.id)).toEqual(["bonsai-base", "bonsai-tree"]);
    expect(hd.map((d) => d.path)).toEqual(["assets/bonsai-base-hd.glb", "assets/bonsai-tree-hd.glb"]);
    expect(hostMeshEnvironmentDecl(decls, "hd")?.path).toBe("assets/env-hd.jpg");
    expect(hostMeshEnvironmentDecl(decls, "standard")).toBeNull();
  });
});
