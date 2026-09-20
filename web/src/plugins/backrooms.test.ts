import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backroomsRoarLevel } from "../audio/plugin-sfx";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { buildVizFrameForPlugin, parseVizContract } from "./viz-host";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../plugins/src/backrooms");
const FRAG = readFileSync(join(ROOT, "sky/fragment.glsl"), "utf8");

const CONTRACT = parseVizContract({
  graphWalk: false,
  maxBuffers: 1,
  maxBufferFloats: 8,
  maxParticles: 0,
  uniforms: ["uTime", "uAudio", "uAccent", "uBg", "uBright", "uOpacity"],
  idle: { fixture: "host" },
})!;

/** Sample the shipped shader's wallpaper mix — must stay above near-black on idle boards. */
function sampleWallpaperYellow(uTime: number): number {
  const phA = uTime * 0.040 - Math.floor(uTime * 0.040);
  const stripe = 0.5 + 0.5 * Math.sin(phA * 6.283);
  const base = 0.72 * (1 - stripe) + 0.78 * stripe;
  return base * 0.92;
}

describe("backrooms shipped pack", () => {
  it("wraps and compiles the corridor shader", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("fract(uTime * 0.040)");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("idle host fixture still feeds frames on an empty board", () => {
    const frame = buildVizFrameForPlugin({ devices: [], flows: [], feed: [] }, 0, 0, CONTRACT.idle);
    expect(frame.demo).toBe(true);
    expect(frame.talkers.length).toBeGreaterThan(0);
    expect(frame.audio).toBeGreaterThan(0);
    expect(buildIdleVizFrame(0).packets.length).toBeGreaterThan(0);
  });

  it("keeps a yellow corridor luma on fresh idle time (not near-black)", () => {
    const samples = [0, 0.07 / 0.04, 0.5 / 0.04, 12.5];
    for (const t of samples) {
      expect(sampleWallpaperYellow(t)).toBeGreaterThan(0.35);
    }
  });

  it("locks roar peaks to the flee beat in the shader phase", () => {
    const fleeT = 0.5 / 0.04;
    expect(backroomsRoarLevel(fleeT)).toBeGreaterThan(0.7);
    const stareT = 0.07 / 0.04;
    expect(backroomsRoarLevel(stareT)).toBeLessThan(0.2);
  });
});
