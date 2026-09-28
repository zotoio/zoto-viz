import { describe, expect, it } from "vitest";
import {
  SEAHORSE_X,
  SEAHORSE_Y,
  escape2,
  newtonNucleus,
  perturbEscape,
  referenceOrbit,
  steerEdge,
  stepCanyon,
  tryRenormalize,
  type Cruise2,
  CANYON_HOME,
} from "./cruise";
import { FZ_SLOT, packFractalDrive, resetFractalDrive } from "./drive";
import { IDLE_POINTER } from "./interaction";
import { fractalPresetConfig } from "./config-mutation";

describe("fractal cruise", () => {
  it("finds the period-2 nucleus and renormalizes a window that contains it", () => {
    const nuc = newtonNucleus(-1, 0, 2);
    expect(nuc).not.toBeNull();
    expect(nuc!.x).toBeCloseTo(-1, 5);
    expect(nuc!.size).toBeGreaterThan(0.2);
    expect(tryRenormalize(-1, 0, 0.8)).toBeNull();
  });

  it("perturbation matches a direct escape near the seahorse", () => {
    const cx = SEAHORSE_X;
    const cy = SEAHORSE_Y;
    const orbit = referenceOrbit(cx, cy, 80);
    const dcx = 1e-5;
    const dcy = -4e-6;
    const direct = escape2(cx + dcx, cy + dcy, 80);
    const pert = perturbEscape(orbit, dcx, dcy, false);
    expect(pert.escaped).toBe(direct.escaped);
    if (direct.escaped && pert.escaped) expect(Math.abs(pert.n - direct.n)).toBeLessThan(1.5);
  });

  it("stays on an edge and turns smoothly", () => {
    let c: Cruise2 = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.4 };
    const scale = 0.02;
    const steps: number[] = [];
    for (let i = 0; i < 90; i++) {
      const prev = c;
      c = steerEdge(c, scale, 1 / 30, 48);
      steps.push(Math.hypot(c.x - prev.x, c.y - prev.y));
    }
    const moved = Math.hypot(c.x - SEAHORSE_X, c.y - SEAHORSE_Y);
    expect(moved).toBeGreaterThan(scale * 0.15);
    expect(moved).toBeLessThan(scale * 12);
    let lo = 1e9;
    let hi = -1;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const e = escape2(c.x + Math.cos(ang) * scale * 0.5, c.y + Math.sin(ang) * scale * 0.5, 48);
      lo = Math.min(lo, e.n);
      hi = Math.max(hi, e.n);
    }
    expect(hi - lo).toBeGreaterThan(3);
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const max = sorted[sorted.length - 1]!;
    expect(max).toBeLessThan(median * 8 + scale * 0.02);
  });

  it("walks a 3D canyon without leaving the surface", () => {
    let c = { ...CANYON_HOME };
    const params = { power: 8, scale: 2.1, fold: 0.55, sym: 6, jx: -0.7, jy: 0.2, jz: 0.1, jw: 0.05 };
    for (let i = 0; i < 40; i++) c = stepCanyon(c, 1 / 30, 0, params, 0.4);
    const moved = Math.hypot(c.fx - CANYON_HOME.fx, c.fy - CANYON_HOME.fy, c.fz - CANYON_HOME.fz);
    expect(moved).toBeGreaterThan(0.02);
    expect(Number.isFinite(c.fx + c.cx)).toBe(true);
    expect(Math.hypot(c.fx, c.fy, c.fz)).toBeLessThan(4);
  });

  it("does not clamp the dive, and palette cycle is the slider value", () => {
    resetFractalDrive();
    const cfg = { preset: "mandel-deep", ...fractalPresetConfig("mandel-deep"), paletteCycle: "0", zoomSpeed: "1" };
    for (let i = 0; i < 2200; i++) packFractalDrive(i / 60, 1 / 60, 0, 1.6, cfg, IDLE_POINTER);
    const end = packFractalDrive(40, 1 / 60, 0, 1.6, cfg, IDLE_POINTER);
    expect(end.slot0[FZ_SLOT.precisionClamp]).toBe(0);
    expect(end.slot0[FZ_SLOT.paletteCycle]).toBe(0);
    const deep = (end.slot0[FZ_SLOT.zoomLog] ?? 0) > 13 || (end.slot0[FZ_SLOT.generation] ?? 0) >= 1;
    expect(deep).toBe(true);
    resetFractalDrive();
    const fast = packFractalDrive(0, 1 / 60, 0, 1.6, { ...cfg, paletteCycle: "3.5" }, IDLE_POINTER);
    expect(fast.slot0[FZ_SLOT.paletteCycle]).toBeCloseTo(3.5, 5);
    expect(fast.slot0[FZ_SLOT.mandelCx]).not.toBe(0);
  });
});
