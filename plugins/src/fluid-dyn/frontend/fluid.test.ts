import { describe, expect, it } from "vitest";
import {
  FLUID_CELLS,
  FLUID_N,
  FLUID_OBSTACLE_ID,
  FLUID_ORIGIN,
  FluidSim,
  advanceFluid,
  emptyFluidMemory,
  fluidSolid,
  packFluid,
  resolveFluid,
} from "./fluid";
import { parseFluidOptions } from "./options";

const still = { audio: 0, traffic: 0, kick: false };

function ix(i: number, j: number): number {
  return i + j * FLUID_N;
}

describe("fluid dynamics", () => {
  it("drops ink that stays finite and bounded", () => {
    const opts = parseFluidOptions({ character: "ink" });
    const sim = new FluidSim();
    const mem = emptyFluidMemory();
    for (let i = 0; i < 90; i++) advanceFluid(sim, 1 / 60, opts, still, mem);
    let sum = 0;
    for (let i = 0; i < FLUID_CELLS; i++) {
      const d = sim.dye[i] ?? 0;
      expect(Number.isFinite(d)).toBe(true);
      expect(Number.isFinite(sim.vx[i] ?? 0)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      sum += d;
    }
    expect(sum).toBeGreaterThan(0.4);
  });

  it("damps a velocity spike when viscosity is high", () => {
    const thick = resolveFluid(parseFluidOptions({ character: "lava", viscosity: "1", emitRate: "0", gravity: "0", wind: "0", swirl: "0", stirrer: "0" }));
    const thin = resolveFluid(parseFluidOptions({ character: "vortex", viscosity: "0", emitRate: "0", gravity: "0", wind: "0", swirl: "0", stirrer: "0", obstacle: "0" }));
    expect(thick.viscosity).toBeGreaterThan(thin.viscosity);
    const run = (resolved: ReturnType<typeof resolveFluid>) => {
      const sim = new FluidSim();
      sim.vx[ix(4, 4)] = 2;
      for (let i = 0; i < 18; i++) sim.step(1 / 60, resolved, still);
      let energy = 0;
      for (let i = 0; i < FLUID_CELLS; i++) energy += (sim.vx[i] ?? 0) ** 2 + (sim.vy[i] ?? 0) ** 2;
      return energy;
    };
    expect(run(thick)).toBeLessThan(run(thin) * 0.85);
  });

  it("carries dye downstream in a river wind", () => {
    const opts = parseFluidOptions({
      character: "river",
      emitRate: "0",
      gravity: "0",
      swirl: "0",
      stirrer: "0",
      vorticity: "0",
      wind: "1",
      obstacle: "0",
    });
    const resolved = resolveFluid(opts);
    resolved.obstacle = 0;
    const sim = new FluidSim();
    sim.dye[ix(3, 5)] = 1;
    sim.hue[ix(3, 5)] = 0.4;
    const centroid = () => {
      let mass = 0;
      let moment = 0;
      for (let j = 0; j < FLUID_N; j++) {
        for (let i = 0; i < FLUID_N; i++) {
          const d = sim.dye[ix(i, j)] ?? 0;
          mass += d;
          moment += d * i;
        }
      }
      return mass > 1e-4 ? moment / mass : -1;
    };
    const trace: number[] = [];
    for (let i = 0; i < 24; i++) {
      sim.step(1 / 60, resolved, still);
      if (i === 7 || i === 15 || i === 23) trace.push(Number(centroid().toFixed(2)));
    }
    expect(trace[0] ?? 0).toBeGreaterThan(3.3);
    expect(trace[1] ?? 0).toBeGreaterThan(trace[0] ?? 0);
  });

  it("holds the vortex cylinder at rest", () => {
    const opts = parseFluidOptions({ character: "vortex", wind: "1", emitRate: "0.2" });
    const resolved = resolveFluid(opts);
    expect(resolved.obstacle).toBe(FLUID_OBSTACLE_ID.cylinder);
    const sim = new FluidSim();
    for (let n = 0; n < 40; n++) sim.step(1 / 60, resolved, still);
    let blocked = 0;
    let moving = 0;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const solid = fluidSolid((i + 0.5) / FLUID_N, (j + 0.5) / FLUID_N, resolved.obstacle, resolved.obsX, resolved.obsY, resolved.obsSize);
        const sp = Math.hypot(sim.vx[ix(i, j)] ?? 0, sim.vy[ix(i, j)] ?? 0);
        if (solid) {
          expect(sp).toBe(0);
          blocked += 1;
        } else if (sp > 0.05) moving += 1;
      }
    }
    expect(blocked).toBeGreaterThan(0);
    expect(moving).toBeGreaterThan(0);
  });

  it("packs the grid into eight 64-float slots", () => {
    const opts = parseFluidOptions({ character: "smoke" });
    const sim = new FluidSim();
    advanceFluid(sim, 1 / 30, opts, still, emptyFluidMemory());
    const flat = packFluid(sim, opts);
    expect(flat.length).toBe(512);
    expect(flat[0]).toBe(1);
    expect(flat[14]).toBe(FLUID_N);
    expect(flat[15]).toBe(FLUID_ORIGIN);
    expect(flat[FLUID_ORIGIN]).toBe(sim.dye[0]);
    expect(flat[FLUID_ORIGIN + FLUID_CELLS + 3]).toBe(sim.hue[3]);
    for (let s = 0; s < 8; s++) expect(flat.subarray(s * 64, s * 64 + 64).length).toBe(64);
  });

  it("clears the tank when the character changes", () => {
    const mem = emptyFluidMemory();
    const sim = new FluidSim();
    const ink = parseFluidOptions({ character: "ink" });
    advanceFluid(sim, 1 / 30, ink, still, mem);
    expect(sim.dye.some((v) => v > 0.05)).toBe(true);
    advanceFluid(sim, 0, parseFluidOptions({ character: "lava", paused: "true" }), still, mem);
    expect(sim.dye.every((v) => v === 0)).toBe(true);
  });
});
