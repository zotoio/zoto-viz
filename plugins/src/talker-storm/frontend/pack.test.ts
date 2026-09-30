import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VizDataFrame } from "../../../sdk/viz-contract";
import { VIZ_FIXTURE_IDLE, VIZ_FIXTURES } from "../../../sdk/viz-fixtures";
import yml from "../plugin.yml?raw";
import sky from "../sky/fragment.glsl?raw";
import * as stormSky from "./storm-sky";

// #180 (decided with Performance Pedant): draw the storm from the sky's UBO slots, not a host particle
// lane. writeParticles had no renderer and the scaffold sky never read zotoVizSlots, so the view was a
// flat orange wash (mean 136). Pack uniform writes are clobbered by the host today (H1), so storm data
// has to travel in slots.
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const TAN_V = Math.tan((55 / 2) * (Math.PI / 180));

/** Camera-relative ray (-z forward) through screen point (u, v) in 0..1, 16:10, 55 degree vertical FOV. */
function ray(u: number, v: number): [number, number, number] {
  const x = (u * 2 - 1) * TAN_V * 1.6;
  const y = (v * 2 - 1) * TAN_V;
  const l = Math.hypot(x, y, 1);
  return [x / l, y / l, -1 / l];
}

/** What the host pack mirror writes to slot 0 for this frame; the sky reads only .y (audio). */
function hostSlot0(frame: Pick<VizDataFrame, "audio" | "t">): number[] {
  return [0, frame.audio, frame.t % 1];
}

/** Five frames: 4, 10, 24 (above the 16 cap) and 4 talkers, then none. */
const FRAMES: VizDataFrame[] = [
  VIZ_FIXTURES.idle,
  VIZ_FIXTURES["golden-live"],
  VIZ_FIXTURES["fat-live"],
  VIZ_FIXTURES["vm-live"],
  { ...VIZ_FIXTURE_IDLE, talkers: [] },
];

type Write =
  | { kind: "buffer"; slot: number; data: number[] }
  | { kind: "uniform"; name: string }
  | { kind: "particles"; len: number };

describe("talker-storm sky (#180)", () => {
  it("reads the storm from zotoVizSlots", () => {
    expect(sky).toMatch(/\bzotoVizSlots\s*\[/);
  });

  it("CPU mirror: the idle demo talkers light storm regions with structure (five-patch not uniform)", () => {
    const { talkerStormSky, stormSlots, TS_SKY_GLSL_LINES } = stormSky;
    for (const line of TS_SKY_GLSL_LINES) expect(sky, `mirror line missing from the sky: ${line}`).toContain(line);
    const slots = { hostSlot0: hostSlot0(VIZ_FIXTURE_IDLE), slot1: stormSlots(VIZ_FIXTURE_IDLE).slot1 };
    // 8 x 5 regions; a region is lit when its mean luma >= 40/255.
    let litRegions = 0;
    for (let rj = 0; rj < 5; rj++) {
      for (let ri = 0; ri < 8; ri++) {
        let s = 0;
        for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
          s += lum(talkerStormSky(ray((ri + (i + 0.5) / 6) / 8, (rj + (j + 0.5) / 6) / 5), slots, 10, 1)) * 255;
        }
        if (s / 36 >= 40) litRegions++;
      }
    }
    expect(litRegions).toBeGreaterThanOrEqual(1);
    expect(litRegions).toBeLessThan(40);
    const five = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
      .map(([u, v]) => lum(talkerStormSky(ray(u!, v!), slots, 10, 1)) * 255);
    expect(Math.max(...five) - Math.min(...five)).toBeGreaterThan(6);
    // No talkers -> no storm cell reaches lit.
    const empty = { hostSlot0: hostSlot0(VIZ_FIXTURE_IDLE), slot1: stormSlots({ talkers: [] }).slot1 };
    let emptyLit = 0;
    for (let k = 0; k < 400; k++) if (lum(talkerStormSky(ray((k % 20 + 0.5) / 20, (Math.floor(k / 20) + 0.5) / 20), empty, 10, 1)) * 255 >= 40) emptyLit++;
    expect(emptyLit).toBe(0);
  });

  describe("frontend/index.ts onFrame (real handler, stubbed host)", () => {
    const g = globalThis as { zoto?: unknown };
    const writes: Write[] = [];
    const z: {
      onFrame: ((frame: VizDataFrame) => void) | null;
      writeBuffer: (slot: number, data: ArrayLike<number>) => void;
      writeUniform: (name: string) => void;
      writeParticles: (data: ArrayLike<number>) => void;
    } = {
      onFrame: null,
      writeBuffer: (slot, data) => writes.push({ kind: "buffer", slot, data: Array.from(data) }),
      writeUniform: (name) => writes.push({ kind: "uniform", name }),
      writeParticles: (data) => writes.push({ kind: "particles", len: data.length }),
    };

    beforeAll(async () => {
      g.zoto = z;
      await import("./index");
    });
    afterAll(() => {
      delete g.zoto;
    });

    function runFrame(frame: VizDataFrame): Write[] {
      writes.length = 0;
      expect(typeof z.onFrame, "index.ts must set zoto.onFrame").toBe("function");
      z.onFrame!(frame);
      return [...writes];
    }

    it("never writes host-owned slot 0 (5 frames), and the manifest caps are exact for what it does write", () => {
      // Slot 0 belongs to the host pack mirror (viz-frame-tick -> viz-pack-host), which writes
      // [count, audio, t mod 1] there every frame; a pack write would race it.
      let slot0Writes = 0;
      let maxSlot = -1;
      let maxLen = 0;
      for (const frame of FRAMES) {
        for (const w of runFrame(frame)) {
          if (w.kind !== "buffer") continue;
          if (w.slot === 0) slot0Writes++;
          maxSlot = Math.max(maxSlot, w.slot);
          maxLen = Math.max(maxLen, w.data.length);
        }
      }
      expect(slot0Writes, "pack writes to slot 0 over 5 frames").toBe(0);
      const maxBuffers = Number(yml.match(/^\s*maxBuffers:\s*(\d+)/m)?.[1]);
      const maxFloats = Number(yml.match(/^\s*maxBufferFloats:\s*(\d+)/m)?.[1]);
      expect(maxBuffers).toBe(2);
      expect(maxFloats).toBe(stormSky.TS_MAX_TALKERS * 4);
      // The caps are used, not padded: slot 1 is the top slot and fat-live (24 talkers) fills it.
      expect(maxSlot).toBe(maxBuffers - 1);
      expect(maxLen).toBe(maxFloats);
    });

    it("writes stormSlots(frame).slot1 to slot 1 on every frame, with no particle or slot 0 writes", () => {
      for (const frame of FRAMES) {
        const w = runFrame(frame);
        const buffers = w.filter((x) => x.kind === "buffer");
        expect(buffers, `${frame.talkers.length} talkers`).toEqual([
          { kind: "buffer", slot: 1, data: stormSky.stormSlots(frame).slot1 },
        ]);
        expect(w.filter((x) => x.kind === "particles").length, "particle writes").toBe(0);
        expect(buffers.filter((x) => x.slot === 0).length, "slot 0 writes").toBe(0);
      }
    });
  });
});
