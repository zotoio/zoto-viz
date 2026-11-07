import { describe, expect, it } from "vitest";
import { AquariumSim, parseAquariumOptions } from "./aquarium";
import { TANK } from "./fish-behaviour";
import { easeHalfW, POP_CAP, SWIM_INSET, TANK_BASE_HALF_W, populationFor, REF_PIXELS, tankForPane, TANK_HALF_H } from "./tank-geometry";

describe("pane-sized tank", () => {
  it("matches the pane aspect, edge to edge", () => {
    for (const [w, h] of [[5120, 1440], [1556, 769], [800, 600], [640, 900], [1920, 1080]] as const) {
      const g = tankForPane(w / h, w * h);
      expect(g.aspect).toBeCloseTo(w / h, 5);
      expect((2 * g.halfW) / (2 * g.halfH)).toBeCloseTo(w / h, 5);
    }
  });

  it("never stretches fish or decor: height fixed, uniform scale 1", () => {
    const a = tankForPane(5120 / 1440, 5120 * 1440);
    const b = tankForPane(800 / 600, 800 * 600);
    expect(a.scale).toBe(1);
    expect(b.scale).toBe(1);
    expect(a.halfH).toBe(TANK_HALF_H);
    expect(b.halfH).toBe(TANK_HALF_H);
  });

  it("puts more fish in bigger tanks, up to the cap", () => {
    const small = populationFor(12, tankForPane(640 / 480, 640 * 480));
    const ref = populationFor(12, tankForPane(TANK_BASE_HALF_W / TANK_HALF_H, REF_PIXELS));
    const wall = populationFor(12, tankForPane(5120 / 1440, 5120 * 1440));
    expect(small).toBeLessThan(ref);
    expect(ref).toBe(12);
    expect(wall).toBeGreaterThan(ref);
    expect(wall).toBeLessThanOrEqual(POP_CAP);
  });

  it("eases the tank length on resize instead of popping", () => {
    let w = 1.2;
    const steps: number[] = [];
    for (let i = 0; i < 120; i++) { const n = easeHalfW(w, 2.6, 1 / 60); steps.push(Math.abs(n - w)); w = n; }
    expect(Math.max(...steps)).toBeLessThan(0.05);
    for (let i = 0; i < 600; i++) w = easeHalfW(w, 2.6, 1 / 60);
    expect(w).toBeCloseTo(2.6, 3);
  });

  it("the sim follows the pane: wider tank, more fish, fish inside the moving glass", () => {
    const talkers = Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, rate: 40 + i * 10, role: "lan" }));
    const sim = new AquariumSim(parseAquariumOptions({ fishCount: "10" }));
    const frame = (t: number) => ({ t, dt: 1 / 60, audio: 0, talkers, packets: [], demo: false });
    sim.setPane(1280 / 800, REF_PIXELS);
    for (let i = 0; i < 120; i++) sim.advance(frame(i / 60));
    const before = sim.fishSlotCap();
    sim.setPane(5120 / 1440, 5120 * 1440);
    let maxStep = 0, prev = sim.tankHalfW();
    for (let i = 120; i < 900; i++) {
      sim.advance(frame(i / 60));
      maxStep = Math.max(maxStep, Math.abs(sim.tankHalfW() - prev));
      prev = sim.tankHalfW();
    }
    expect(sim.fishSlotCap()).toBeGreaterThan(before);
    expect(sim.tankHalfW()).toBeCloseTo(TANK_HALF_H * 5120 / 1440, 2);
    expect(maxStep).toBeLessThan(0.05);
    expect(sim.visibleFishIds().length).toBe(sim.fishSlotCap());
    // shrink to a small mosaic pane: fish fade out and everyone stays inside the glass
    sim.setPane(640 / 480, 640 * 480);
    for (let i = 900; i < 1500; i++) sim.advance(frame(i / 60));
    expect(sim.visibleFishIds().length).toBe(sim.fishSlotCap());
    expect(TANK.xMax).toBeCloseTo(sim.tankHalfW() - SWIM_INSET, 6);
    sim.setPane(1280 / 800, REF_PIXELS);
    for (let i = 1500; i < 2400; i++) sim.advance(frame(i / 60));
  });
});
