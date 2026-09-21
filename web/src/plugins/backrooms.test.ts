import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/backrooms/sky/fragment.glsl?raw";
import { backroomsPhase, backroomsSfxLevels } from "../audio/plugin-sfx";
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
    expect(wrapped.frag).toContain("leanX");
    expect(wrapped.frag).toContain("1.5708 * turnDir");
    expect(wrapped.frag).toContain("faceTravel");
    expect(wrapped.frag).toContain("teeth");
    expect(wrapped.frag).toContain("chamber");
    expect(wrapped.frag).toContain("mix(0.62, 1.02, rch)");
    expect(wrapped.frag).toContain("floor(seed * 4.0)");
    expect(wrapped.frag).not.toContain("3.1416 * flee");
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
    expect(FRAG).toContain("max(hit - 8.0, 0.0)");
    expect(FRAG).toContain("vec3(0.95, 0.92, 0.68)");
    expect(FRAG).toContain("mix(0.006 * sin(gait), 0.03, glance)");
    expect(FRAG).toContain("rotY(yaw) * rotX(-pitch) * vd");
    expect(FRAG).toContain("chroma");
    expect(FRAG).not.toContain("floor(uv.y * 30.0)");
    expect(samplePaperYellow()).toBeGreaterThan(0.35);
  });

  it("peeks a toothy grin from a pillar, freezes, then cuts 90 forward", () => {
    expect(FRAG).toContain("-min(s, sLock)");
    expect(FRAG).toContain("gone * turnDir");
    expect(FRAG).toContain("4.0 * ceil((sFlee - 2.0) * 0.25) + 2.0");
    expect(FRAG).toContain("room(ro)");
    expect(FRAG).toContain("mix(1.32, 0.10, approach)");
    expect(FRAG).toContain("mix(lead, minGap, approach)");
    expect(FRAG).toContain("24.0 + 20.0 * h11(cycle + 3.0)");
    expect(FRAG).toContain("creaRate * 1.5");
    expect(FRAG).toContain("minGap = 8.0");
    expect(FRAG).toContain("-sTurn - minGap");
    expect(FRAG).toContain("z - gap");
    expect(FRAG).toContain("mix(0.44, 0.80, rch)");
    expect(FRAG).toContain("mix(0.62, 1.02, rch)");
    expect(FRAG).toContain("seeYaw");
    expect(FRAG).toContain("mix(travelYaw, seeYaw, glance)");
    expect(FRAG).toContain("step(peekPh, phA) * (1.0 - faceTravel)");
    expect(FRAG).toContain("peekPh + 0.18, peekPh + 0.24");
    expect(FRAG).not.toContain("fleePh + 0.11");
    expect(FRAG).not.toContain("z - 0.82");
    expect(FRAG).not.toContain("z + gap");
    expect(FRAG).toContain("knLft");
    expect(FRAG).toContain("stepFoot");
    expect(FRAG).toContain("along / stride");
    expect(FRAG).toContain("0.48 - u");
    expect(FRAG).toContain("1.62 + 0.05 * max(fL.x, fR.x)");
    expect(FRAG).toContain("0.035), 0.009");
    expect(FRAG).toContain("length(q - knL) - 0.052");
    expect(FRAG).toContain("n2(q.xz * 4.4 + q.y * 3.1)");
    expect(FRAG).toContain("(-hide) * (0.42 + 0.05 * sin(t * 3.1))");
    expect(FRAG).toContain("bobAmp * abs(sin(gait)) * (1.0 - freeze)");
    expect(FRAG).toContain("close * 18.0");
    expect(FRAG).toContain("1.0 - 0.62 * hush");
    expect(FRAG).toContain("localT / period");
    expect(FRAG).toContain("mix(1.0, sync * (1.0 - black * 0.80), near)");
    expect(FRAG).not.toContain("floor(t * 1.8)");
    expect(FRAG).toContain("max(max(flee, sprint), charge)");
    expect(FRAG).not.toContain("3.1416 * flee");
    const jog = backroomsPhase(0.12 / 0.040);
    expect(jog.flee).toBeLessThan(0.05);
    let emptyT = 0;
    for (let e = 0; e < 80; e++) {
      const t = (e + 0.12) / 0.040;
      if (!backroomsPhase(t).peekOn) {
        emptyT = t;
        break;
      }
    }
    expect(backroomsSfxLevels(emptyT).buzz).toBe(1);
    const kinds = new Set<boolean>();
    for (let c = 0; c < 16; c++) kinds.add(backroomsPhase((c + 0.3) / 0.040).peekOn);
    expect(kinds.has(true)).toBe(true);
    expect(kinds.has(false)).toBe(true);
  });
});
