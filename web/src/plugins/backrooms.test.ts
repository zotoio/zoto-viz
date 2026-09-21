import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/backrooms/sky/fragment.glsl?raw";
import { backroomsRoarLevel } from "../audio/plugin-sfx";
import type { StateMsg } from "../core/types";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { buildVizFrameForPlugin, parseVizContract } from "./viz-host";

const CONTRACT = parseVizContract({
  graphWalk: false,
  maxBuffers: 1,
  maxBufferFloats: 8,
  maxParticles: 0,
  uniforms: ["uTime", "uAudio", "uAccent", "uBg", "uBright", "uOpacity"],
  idle: { fixture: "host" },
})!;

/** Conservative Level-0 paper luma from the shipped maze shader (not the old box corridor). */
function samplePaperYellow(): number {
  const paper = [0.97, 0.94, 0.70];
  const fill = 0.92 * 0.90;
  return ((paper[0] + paper[1] + paper[2]) / 3) * fill;
}

describe("backrooms shipped pack", () => {
  it("wraps and compiles the corridor shader", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("fract(t * 0.040)");
    expect(wrapped.frag).toContain("chargeAge");
    expect(wrapped.frag).toContain("chamber");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("idle host fixture still feeds frames on an empty board", () => {
    const empty: StateMsg = {
      type: "state",
      ts: 0,
      iface: "",
      interfaces: [],
      network: "",
      local_ip: "",
      gateway: "",
      uptime: 0,
      stats: {
        pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
      },
      devices: [],
      flows: [],
    };
    const frame = buildVizFrameForPlugin(empty, 0, 0, CONTRACT.idle);
    expect(frame.demo).toBe(true);
    expect(frame.talkers.length).toBeGreaterThan(0);
    expect(frame.audio).toBeGreaterThan(0);
    expect(buildIdleVizFrame(0).packets.length).toBeGreaterThan(0);
  });

  it("keeps a yellow corridor luma on fresh idle time (not near-black)", () => {
    expect(FRAG).toContain("vec3(0.97, 0.94, 0.70)");
    expect(FRAG).toContain("rotY(yaw) * rotX(-pitch) * vd");
    expect(FRAG).toContain("chroma");
    expect(FRAG).not.toContain("floor(uv.y * 30.0)");
    expect(samplePaperYellow()).toBeGreaterThan(0.35);
  });

  it("locks roar peaks to the flee beat in the shader phase", () => {
    const fleeT = 0.5 / 0.04;
    expect(backroomsRoarLevel(fleeT)).toBeGreaterThan(0.7);
    const stareT = 0.07 / 0.04;
    expect(backroomsRoarLevel(stareT)).toBeLessThan(0.2);
  });
});
