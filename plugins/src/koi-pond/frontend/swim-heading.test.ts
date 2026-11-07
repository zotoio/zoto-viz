import { describe, expect, it } from "vitest";
import { demoFrame, KoiPondSim, parseKoiPondOptions } from "./koi-pond";

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

type KoiBodyView = { vx: number; vz: number; yaw: number; x: number; z: number };

/** Private `koi` map — Reflect, no `as unknown as` (#192 cast guard). */
function koiBodies(sim: KoiPondSim): Iterable<KoiBodyView> {
  const map = Reflect.get(sim, "koi") as Map<string, KoiBodyView>;
  return map.values();
}

describe("koi head-first swim + pond coverage", () => {
  it("yaw stays aligned with velocity (no sideways/backwards drift)", () => {
    const sim = new KoiPondSim(
      parseKoiPondOptions({ swimSpeed: "0.38", schooling: "0.25", followCam: "false" }),
    );
    for (let i = 0; i < 120; i++) sim.advance(demoFrame(i / 60), 1280, 800);
    let checked = 0;
    for (let i = 0; i < 180; i++) sim.advance(demoFrame(2 + i / 60), 1280, 800);
    for (const k of koiBodies(sim)) {
      const spd = Math.hypot(k.vx, k.vz);
      if (spd < 0.01) continue;
      const velYaw = Math.atan2(k.vx, k.vz);
      const err = Math.abs(wrap(velYaw - k.yaw));
      expect(err).toBeLessThan(0.35);
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
      for (const k of koiBodies(sim)) {
        const cx = Math.floor((k.x + 1.3) / 0.45);
        const cz = Math.floor((k.z + 1.2) / 0.45);
        cells.add(`${cx},${cz}`);
      }
    }
    expect(cells.size).toBeGreaterThanOrEqual(10);
  });
});
