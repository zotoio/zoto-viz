import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bandY, EXPLORE_NZ, exploreCell, exploreNx, FRESH_TRAITS, homeSpot, REEF_TRAITS, setTankHalfWidth, stepSchool, TANK, type SwimFish } from "./fish-behaviour";

function fish(i: number, species: number, x: number, z: number): SwimFish {
  return { id: `f${i}`, species, vigor: 0.5, x, y: 0, z, yaw: i * 1.3, speed: 0.1, vy: 0, turnRate: 0,
    phase: i, mood: "cruise", moodT: 0, wander: 0, plant: 0, rs: 991 + i * 131, aggr: false };
}

/** Simulate `mins` minutes; per depth band: share of grid cells visited, and time inside the band. */
export function coverageRun(reef: boolean, halfW: number, mins: number, mix: number[]) {
  setTankHalfWidth(halfW - 0.02);
  const traits = reef ? REEF_TRAITS : FRESH_TRAITS;
  const school = mix.map((sp, i) => fish(i, sp, TANK.xMin + 0.3 + ((i * 0.37) % 1) * (TANK.xMax - TANK.xMin - 0.6), -0.3 + ((i * 0.61) % 1) * 0.6));
  for (const f of school) f.y = (bandY(traits[f.species]!.yMin) + bandY(traits[f.species]!.yMax)) / 2;
  const nx = exploreNx();
  const bandOf = (sp: number) => { const m = (traits[sp]!.yMin + traits[sp]!.yMax) / 2; return m < -0.2 ? "bottom" : m < 0.3 ? "mid" : "top"; };
  const seen: Record<string, Set<number>> = { top: new Set(), mid: new Set(), bottom: new Set() };
  const inBand: Record<string, [number, number]> = { top: [0, 0], mid: [0, 0], bottom: [0, 0] };
  const heat = new Float32Array(nx * EXPLORE_NZ);
  const dt = 1 / 30;
  for (let k = 0; k < mins * 60 * 30; k++) {
    stepSchool(school, { reef, temperament: 0.3, food: null, cursor: null, motion: 1 }, dt);
    if (k % 15) continue;
    for (const f of school) {
      const b = bandOf(f.species);
      const c = exploreCell(f.x, f.z, nx);
      seen[b]!.add(c); heat[c]! += 1;
      const tr = traits[f.species]!;
      const lo = bandY(tr.yMin) - 0.08, hi = bandY(tr.yMax) + 0.08;
      inBand[b]![1]++; if (f.y >= lo && f.y <= hi) inBand[b]![0]++;
    }
  }
  const out: Record<string, { coverage: number; inBand: number }> = {};
  for (const b of ["top", "mid", "bottom"]) {
    if (!inBand[b]![1]) continue;
    out[b] = { coverage: seen[b]!.size / (nx * EXPLORE_NZ), inBand: inBand[b]![0] / inBand[b]![1] };
  }
  setTankHalfWidth(1.2);
  return { bands: out, heat, nx };
}

// freshwater: 6 neon (school, top-mid), 3 guppy (top), 2 angel + 1 discus (hover, mid), 3 cory (bottom)
const FRESH_MIX = [0, 0, 0, 0, 0, 0, 2, 2, 2, 1, 1, 4, 3, 3, 3];

describe("fish explore the whole tank in their layers", () => {
  for (const [label, halfW] of [["standard tank", 1.22], ["5120x1440 ultrawide", 0.82 * 5120 / 1440]] as const) {
    it(`${label}: every band covers >= 80% of cells, >= 75% of time in its band (10 min)`, () => {
      const r = coverageRun(false, halfW, 10, FRESH_MIX);
      // AQ_HEAT_OUT=<dir>: dump the visit heatmap (for the coverage screenshot)
      const out = process.env.AQ_HEAT_OUT;
      if (out) writeFileSync(`${out}/heat-${halfW.toFixed(2)}.json`, JSON.stringify({ nx: r.nx, nz: EXPLORE_NZ, heat: Array.from(r.heat), bands: r.bands }));
      for (const [b, v] of Object.entries(r.bands)) {
        expect(v.coverage, `${b} coverage`).toBeGreaterThanOrEqual(0.8);
        expect(v.inBand, `${b} in band`).toBeGreaterThanOrEqual(0.75);
      }
    }, 60_000);
  }

  it("territories spread end to end on a long tank", () => {
    setTankHalfWidth(2.9);
    const xs = [0, 1, 2, 3, 4, 5].map((h) => homeSpot({ ...fishStub(), home: h })[0]);
    setTankHalfWidth(1.2);
    expect(Math.min(...xs)).toBeLessThan(-1.8);
    expect(Math.max(...xs)).toBeGreaterThan(1.8);
  });
});

function fishStub(): SwimFish {
  return fish(0, 0, 0, 0);
}
