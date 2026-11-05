import { describe, expect, it } from "vitest";
import { demoFrame, KoiPondSim, parseKoiPondOptions } from "./koi-pond";

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

describe("koi head-first swim + pond coverage", () => {
  it("yaw stays aligned with velocity (no sideways/backwards drift)", () => {
    const sim = new KoiPondSim(
      parseKoiPondOptions({ swimSpeed: "0.38", schooling: "0.25", followCam: "false" }),
    );
    // warm up
    for (let i = 0; i < 120; i++) sim.advance(demoFrame(i / 60), 1280, 800);
    let checked = 0;
    for (let i = 0; i < 180; i++) {
      const packed = sim.advance(demoFrame(2 + i / 60), 1280, 800);
      const n = Math.round(packed.slot0[24] || 0); // koiCount
      for (let f = 0; f < n; f++) {
        const base = f * 4;
        // reconstruct approx velocity from consecutive frames via yaw/nose
        const yaw = packed.slot1[base + 3]!;
        // sample body fields from sim internals
      }
    }
    // Direct body check
    for (const k of (sim as unknown as { koi: Map<string, { vx: number; vz: number; yaw: number }> }).koi.values()) {
      const spd = Math.hypot(k.vx, k.vz);
      if (spd < 0.01) continue;
      const velYaw = Math.atan2(k.vx, k.vz);
      const err = Math.abs(wrap(velYaw - k.yaw));
      expect(err).toBeLessThan(0.35); // ~20° — soft spring, never sideways/backwards
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

  it("koi spread across the pond over time (edges + open water)", () => {
    const sim = new KoiPondSim(
      parseKoiPondOptions({ swimSpeed: "0.55", schooling: "0.15", followCam: "false", koiCap: "10" }),
    );
    const cells = new Set<string>();
    for (let i = 0; i < 900; i++) {
      sim.advance(demoFrame(i / 60), 1280, 800);
      if (i % 15 !== 0) continue;
      for (const k of (sim as unknown as { koi: Map<string, { x: number; z: number }> }).koi.values()) {
        const cx = Math.floor((k.x + 1.3) / 0.45);
        const cz = Math.floor((k.z + 1.2) / 0.45);
        cells.add(`${cx},${cz}`);
      }
    }
    // A clustered school would occupy ~2–4 cells; exploration should visit many.
    expect(cells.size).toBeGreaterThanOrEqual(10);
  });
});
