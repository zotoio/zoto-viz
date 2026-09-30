import { describe, expect, it } from "vitest";
import { VIZ_FIXTURE_IDLE } from "../../../sdk/viz-fixtures";
import sky from "../sky/fragment.glsl?raw";
import * as constellationSky from "./constellation-sky";

// #180: DEMO_RF beacons reach ubo slot 0 but the scaffold sky never read zotoVizSlots, so no beacon was
// ever drawn (lit 0, mean 7.1 on the box).
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** 16:10 frame of camera-relative rays (-z forward, 55 degree vertical FOV like the stage camera). */
function frameDirs(w = 64, h = 40): [number, number, number][] {
  const tanV = Math.tan((55 / 2) * (Math.PI / 180));
  const out: [number, number, number][] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / w * 2 - 1) * tanV * 1.6;
      const y = ((j + 0.5) / h * 2 - 1) * tanV;
      const l = Math.hypot(x, y, 1);
      out.push([x / l, y / l, -1 / l]);
    }
  }
  return out;
}

function mirror(): typeof constellationSky {
  return constellationSky;
}

describe("rf-constellation sky (#180)", () => {
  it("reads the beacons from zotoVizSlots", () => {
    expect(sky).toMatch(/\bzotoVizSlots\s*\[/);
  });

  it("CPU mirror: the idle demo beacons light points on a -z-forward frame", async () => {
    const { rfConstellationSky, rfBeaconBuffer, RF_SKY_GLSL_LINES } = await mirror();
    for (const line of RF_SKY_GLSL_LINES) expect(sky, `mirror line missing from the sky: ${line}`).toContain(line);
    const slot0 = rfBeaconBuffer(VIZ_FIXTURE_IDLE.rf);
    expect(slot0.length).toBe(VIZ_FIXTURE_IDLE.rf.length * 3);
    const dirs = frameDirs();
    const lit = dirs.filter((d) => lum(rfConstellationSky(d, slot0, 10, 1)) * 255 >= 40).length;
    expect(lit).toBeGreaterThanOrEqual(1);
    expect(lit / dirs.length).toBeGreaterThan(0.02);
    // No beacons -> no lit points: the light comes from the slot.
    const dark = dirs.filter((d) => lum(rfConstellationSky(d, [], 10, 1)) * 255 >= 40).length;
    expect(dark).toBe(0);
  });

  it("slot 0 layout matches the host pack mirror: [rssi, channel/165, index/8] per beacon", async () => {
    const { rfBeaconBuffer } = await mirror();
    const buf = rfBeaconBuffer(VIZ_FIXTURE_IDLE.rf);
    VIZ_FIXTURE_IDLE.rf.forEach((b, i) => {
      expect(buf[i * 3]).toBeCloseTo(b.rssi, 6);
      expect(buf[i * 3 + 1]).toBeCloseTo(b.channel / 165, 6);
      expect(buf[i * 3 + 2]).toBeCloseTo(i / 8, 6);
    });
    const many = Array.from({ length: 12 }, (_, i) => ({ ssid: `s${i}`, rssi: 0.5, channel: 11 }));
    expect(rfBeaconBuffer(many).length).toBe(24);
  });
});
