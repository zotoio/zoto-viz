import { describe, expect, it } from "vitest";
import { parseStereoTiming } from "../../../plugins/src/stereo-gram/frontend/drive";
import {
  STEREO_BLOCK, STEREO_FRAME_PARTS, STEREO_FRAME_SLOTS, STEREO_Z_RANGE, buildStereoFrame, burstTime, fineGate,
} from "../../../plugins/src/stereo-gram/frontend/frame";
import { packStereoScene } from "../../../plugins/src/stereo-gram/frontend/recipe";

const HEAD = 6 * 64;
const objects = parseStereoTiming({ audio: "0", ai: "0" });

function frameAt(clock: number, timing = objects, extra: Partial<Parameters<typeof buildStereoFrame>[0]> = {}) {
  return buildStereoFrame({ timing, clock, act: 0.5, level: 0.5, bins: [0.2, 0.9, 0.4, 0.6, 0.1, 0.3], ai: null, ...extra });
}

function parts(f: Float32Array): { a: number[]; r: number; b: number[]; g: number }[] {
  return Array.from({ length: f[HEAD]! }, (_, i) => ({
    a: [f[i * 8]!, f[i * 8 + 1]!, f[i * 8 + 2]!], r: f[i * 8 + 3]!,
    b: [f[i * 8 + 4]!, f[i * 8 + 5]!, f[i * 8 + 6]!], g: f[i * 8 + 7]!,
  }));
}

describe("stereogram frame", () => {
  it("fills slots 1–7 with world parts and a header for the object cycle", () => {
    const f = frameAt(5);
    expect(f).toHaveLength(STEREO_FRAME_SLOTS * 64);
    const ps = parts(f);
    expect(ps.length).toBeGreaterThan(10);
    expect(ps.length).toBeLessThanOrEqual(STEREO_FRAME_PARTS);
    expect(ps.every((p) => p.r > 0)).toBe(true);
    const [, roomA, roomB, roomMix, , pa, pb, , sfar, bands, fineX] = f.slice(HEAD, HEAD + 12);
    expect([roomA, roomB, roomMix]).toEqual([0, 1, 0]);
    expect([pa, pb]).toEqual([0, 1]);
    expect(sfar).toBeCloseTo(0.0104 * objects.repeat);
    expect(bands).toBe(objects.bands);
    expect(fineX).toBeCloseTo(objects.motionBands);
  });

  it("starts each morph from the outgoing object's last pose and ends on the next object's first", () => {
    const hold = objects.hold;
    const before = parts(frameAt(hold - 1e-4));
    const start = parts(frameAt(hold));
    expect(start[0]!.a[0]).toBeCloseTo(before[0]!.a[0], 3);
    expect(start[0]!.a[1]).toBeCloseTo(before[0]!.a[1], 3);
    expect(start[0]!.r).toBeCloseTo(before[0]!.r, 4);
    const period = hold + objects.morph;
    const end = parts(frameAt(period - 1e-4));
    const next = parts(frameAt(period));
    expect(end[0]!.a[0]).toBeCloseTo(next[0]!.a[0], 2);
    expect(end[0]!.r).toBeCloseTo(next[0]!.r, 3);
    const mid = frameAt(hold + objects.morph / 2);
    expect(mid[HEAD + 3]).toBeCloseTo(0.5);
    expect(mid[HEAD + 7]).toBeCloseTo(0.5);
  });

  it("builds one solid per bin for the audio rack, blocks for oblong bars", () => {
    const rack = parseStereoTiming({ audio: "1", ai: "0", shape: "oblong" });
    const ps = parts(frameAt(3, rack));
    expect(ps).toHaveLength(rack.rack.solids);
    expect(ps.every((p) => p.g === STEREO_BLOCK && p.r > 0)).toBe(true);
    expect(ps[1]!.b[1]).toBeGreaterThan(ps[0]!.b[1]);
    const f = frameAt(3, rack);
    expect([f[HEAD + 1], f[HEAD + 2], f[HEAD + 4]]).toEqual([0, 0, 0]);
    const balls = parts(frameAt(3, parseStereoTiming({ audio: "1", ai: "0", shape: "balls" })));
    expect(balls.every((p) => p.g > 0 && p.g <= 1)).toBe(true);
  });

  it("places AI parts about the scene centre on a flat wall", () => {
    const scene = packStereoScene([
      { shape: "ball", at: [0.1, 0, 0.3], to: [0.1, 0, 0.3], r: 0.08, h: 0, bin: -1, react: "none", amt: 0 },
      { shape: "ball", at: [-0.1, 0, 0.3], to: [-0.1, 0, 0.3], r: 0.05, h: 0, bin: -1, react: "none", amt: 0 },
    ], 0, 0.02);
    const f = frameAt(3, objects, { ai: scene });
    const ps = parts(f);
    expect(ps).toHaveLength(2);
    expect(ps[0]!.a[0]).toBeCloseTo(0.1);
    expect(ps[0]!.a[1]).toBeCloseTo(0.02);
    expect(ps[0]!.a[2]).toBeCloseTo(0.3);
    expect([f[HEAD + 1], f[HEAD + 2]]).toEqual([4, 4]);
  });

  it("moves every scene in depth and spreads objects apart", () => {
    const usual = parts(frameAt(5));
    const back = parts(frameAt(5, parseStereoTiming({ audio: "0", ai: "0", depth: "10" })));
    expect(back[0]!.a[2]).toBeCloseTo(usual[0]!.a[2] - 0.3 * STEREO_Z_RANGE, 4);
    const span = (ps: ReturnType<typeof parts>) => {
      const xs = ps.flatMap((p) => p.g === STEREO_BLOCK ? [p.a[0]] : [p.a[0], p.b[0]]);
      return Math.max(...xs) - Math.min(...xs);
    };
    const wide = parts(frameAt(5, parseStereoTiming({ audio: "0", ai: "0", spacing: "200" })));
    expect(span(wide)).toBeCloseTo(2 * span(usual), 3);

    const rack = parseStereoTiming({ audio: "1", ai: "0", shape: "balls" });
    const rackWide = parseStereoTiming({ audio: "1", ai: "0", shape: "balls", spacing: "200" });
    const step = (ps: ReturnType<typeof parts>) => ps[1]!.a[0] - ps[0]!.a[0];
    expect(step(parts(frameAt(3, rackWide)))).toBeCloseTo(2 * step(parts(frameAt(3, rack))), 4);
    const deep = parts(frameAt(3, parseStereoTiming({ audio: "1", ai: "0", shape: "oblong", depth: "80" })));
    const shallow = parts(frameAt(3, parseStereoTiming({ audio: "1", ai: "0", shape: "oblong", depth: "20" })));
    expect(deep[0]!.a[2]).toBeGreaterThan(shallow[0]!.a[2]);

    const scene = packStereoScene([
      { shape: "ball", at: [0.1, 0, 0.3], to: [0.1, 0, 0.3], r: 0.08, h: 0, bin: -1, react: "none", amt: 0 },
      { shape: "ball", at: [-0.1, 0, 0.3], to: [-0.1, 0, 0.3], r: 0.05, h: 0, bin: -1, react: "none", amt: 0 },
    ], 0, 0);
    const spread = parts(frameAt(3, parseStereoTiming({ audio: "0", ai: "0", spacing: "200", depth: "10" }), { ai: scene }));
    expect(spread[0]!.a[0]).toBeCloseTo(0.2);
    expect(spread[1]!.a[0]).toBeCloseTo(-0.2);
    expect(spread[0]!.a[2]).toBeCloseTo(0.3 - 0.3 * STEREO_Z_RANGE, 4);
  });

  it("moves the object clock only in eased bursts, and fines the bands around them", () => {
    expect(burstTime(3.9, 4, 2)).toBe(0);
    expect(burstTime(6, 4, 2)).toBeCloseTo(2);
    expect(burstTime(5, 4, 2)).toBeCloseTo(1);
    expect(burstTime(9, 4, 2)).toBeCloseTo(2);
    expect(fineGate(2, 16, 4, 2)).toBe(0);
    expect(fineGate(5, 16, 4, 2)).toBe(1);
    expect(fineGate(17, 16, 4, 2)).toBe(1);
    expect(fineGate(2, 16, 0, 2)).toBe(1);
  });
});
