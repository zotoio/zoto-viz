import { describe, expect, it } from "vitest";
import {
  SEAHORSE_X,
  SEAHORSE_Y,
  de3,
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
import { fractalTypeIndex, parseFractalOptions } from "./options";

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
    let path = 0;
    let prev = c;
    const early = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 160; i++) {
      c = stepCanyon(c, 1 / 30, 0, params, 0.4);
      path += Math.hypot(c.fx - prev.fx, c.fy - prev.fy, c.fz - prev.fz);
      if (i === 24) {
        early.x = c.fx - CANYON_HOME.fx;
        early.y = c.fy - CANYON_HOME.fy;
        early.z = c.fz - CANYON_HOME.fz;
      }
      prev = c;
    }
    const moved = Math.hypot(c.fx - CANYON_HOME.fx, c.fy - CANYON_HOME.fy, c.fz - CANYON_HOME.fz);
    expect(moved).toBeGreaterThan(0.02);
    expect(Number.isFinite(c.fx + c.cx)).toBe(true);
    expect(Math.hypot(c.fx, c.fy, c.fz)).toBeLessThan(4);
    const eye = Math.hypot(c.fx - c.cx, c.fy - c.cy, c.fz - c.cz);
    expect(eye).toBeGreaterThan(0.02);
    expect(eye).toBeLessThan(0.35);
    expect(de3(0, c.fx, c.fy, c.fz, params)).toBeLessThan(0.2);
    const lateX = c.fx - (CANYON_HOME.fx + early.x);
    const lateY = c.fy - (CANYON_HOME.fy + early.y);
    const lateZ = c.fz - (CANYON_HOME.fz + early.z);
    const dot = early.x * lateX + early.y * lateY + early.z * lateZ;
    const el = Math.hypot(early.x, early.y, early.z) * Math.hypot(lateX, lateY, lateZ);
    const bend = el > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, dot / el))) : 0;
    expect(bend).toBeGreaterThan(0.25);
    expect(path).toBeGreaterThan(moved * 1.02);
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

  it("#180: after resetFractalDrive the canyon camera is outside the surface on frames 1..10", () => {
    // Red at d276d5df: the Mandelbulb start (CANYON_HOME) puts the camera at de(cam) -0.0157 on frame 1.
    const presets = ["", "bulb-classic", "box-abyss", "menger-tunnel", "sierpinski-crystal", "julia-quaternion", "kaleido-ifs"];
    for (const preset of presets) {
      resetFractalDrive();
      const cfg = preset ? fractalPresetConfig(preset) : {};
      const o = parseFractalOptions(cfg);
      const kind = fractalTypeIndex(o.type);
      const p = { power: o.power, scale: o.scale, fold: o.fold, sym: o.kaleidoSym, jx: o.juliaCr, jy: o.juliaCi, jz: o.quatC2, jw: o.quatC3 };
      for (let f = 1; f <= 10; f++) {
        const s = packFractalDrive(f / 60, 1 / 60, 0, 1.6, cfg, IDLE_POINTER).slot0;
        const dCam = de3(kind, s[FZ_SLOT.camX]!, s[FZ_SLOT.camY]!, s[FZ_SLOT.camZ]!, p);
        expect(dCam, `${preset || "(default)"} frame ${f} de3(cam)`).toBeGreaterThan(0);
        expect(dCam, `${preset || "(default)"} frame ${f} de3(cam) vs half the canyon clearance`).toBeGreaterThan(0.02);
      }
    }
  });
});
