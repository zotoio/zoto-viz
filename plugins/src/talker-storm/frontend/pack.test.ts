import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIZ_FIXTURE_IDLE } from "../../../sdk/viz-fixtures";

// #180 (decided with Performance Pedant): draw the storm from the sky's UBO slots, not a host particle
// lane. writeParticles had no renderer and the scaffold sky never read zotoVizSlots, so the view was a
// flat orange wash (mean 136). Pack uniform writes are clobbered by the host today (H1), so storm data
// has to travel in slots.
const here = path.dirname(new URL(import.meta.url).pathname);
const sky = readFileSync(path.join(here, "..", "sky", "fragment.glsl"), "utf8");
const yml = readFileSync(path.join(here, "..", "plugin.yml"), "utf8");
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const TAN_V = Math.tan((55 / 2) * (Math.PI / 180));

/** Camera-relative ray (-z forward) through screen point (u, v) in 0..1, 16:10, 55 degree vertical FOV. */
function ray(u: number, v: number): [number, number, number] {
  const x = (u * 2 - 1) * TAN_V * 1.6;
  const y = (v * 2 - 1) * TAN_V;
  const l = Math.hypot(x, y, 1);
  return [x / l, y / l, -1 / l];
}

async function mirror() {
  // Loaded by path so a missing mirror fails its own rows only.
  return (await import(/* @vite-ignore */ path.join(here, "storm-sky.ts"))) as typeof import("./storm-sky");
}

describe("talker-storm sky (#180)", () => {
  it("reads the storm from zotoVizSlots", () => {
    expect(sky).toMatch(/\bzotoVizSlots\s*\[/);
  });

  it("CPU mirror: the idle demo talkers light storm regions with structure (five-patch not uniform)", async () => {
    const { talkerStormSky, stormSlots, TS_SKY_GLSL_LINES } = await mirror();
    for (const line of TS_SKY_GLSL_LINES) expect(sky, `mirror line missing from the sky: ${line}`).toContain(line);
    const slots = stormSlots(VIZ_FIXTURE_IDLE);
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
    const empty = stormSlots({ ...VIZ_FIXTURE_IDLE, talkers: [] });
    let emptyLit = 0;
    for (let k = 0; k < 400; k++) if (lum(talkerStormSky(ray((k % 20 + 0.5) / 20, (Math.floor(k / 20) + 0.5) / 20), empty, 10, 1)) * 255 >= 40) emptyLit++;
    expect(emptyLit).toBe(0);
  });

  it("slot 0 keeps the host pack-mirror layout and the storm fits the manifest caps", async () => {
    const { stormSlots, TS_MAX_TALKERS } = await mirror();
    const s = stormSlots(VIZ_FIXTURE_IDLE);
    const count = VIZ_FIXTURE_IDLE.talkers.reduce((n, t) => n + Math.min(8, Math.ceil(t.rate / 40)), 0);
    expect(s.slot0).toEqual([count, VIZ_FIXTURE_IDLE.audio, VIZ_FIXTURE_IDLE.t % 1]);
    expect(s.slot1.length).toBe(Math.min(TS_MAX_TALKERS, VIZ_FIXTURE_IDLE.talkers.length) * 4);
    const maxBuffers = Number(yml.match(/^\s*maxBuffers:\s*(\d+)/m)?.[1]);
    const maxFloats = Number(yml.match(/^\s*maxBufferFloats:\s*(\d+)/m)?.[1]);
    expect(maxBuffers).toBeGreaterThanOrEqual(2);
    expect(maxFloats).toBeGreaterThanOrEqual(TS_MAX_TALKERS * 4);
  });
});
