import { describe, expect, it } from "vitest";
import {
  clampParticleCap,
  easePhysToward,
  MAGNET_FIELDS,
  magnetPair,
  MAX_PARTICLES,
  particlesOnLink,
  PHYS_EASE_KEYS,
  pickPhys,
  stringPoint,
  stringSegs,
} from "./physics";

describe("particlesOnLink", () => {
  const base = { amt: 1, busy: 1, quiet: 0, peak: 40, cap: MAX_PARTICLES };

  it("spawns nothing when the link is quiet or density is off", () => {
    expect(particlesOnLink(0, base)).toBe(0);
    expect(particlesOnLink(800, { ...base, amt: 0 })).toBe(0);
    expect(particlesOnLink(50, { ...base, quiet: 100 })).toBe(0);
  });

  it("drops count when amt, busy, or peak are turned down", () => {
    const busy = particlesOnLink(50_000, base);
    expect(busy).toBeGreaterThan(4);
    expect(particlesOnLink(50_000, { ...base, amt: 0.25 })).toBeLessThan(busy);
    expect(particlesOnLink(50_000, { ...base, busy: 0.25 })).toBeLessThan(busy);
    expect(particlesOnLink(50_000, { ...base, peak: 2 })).toBe(2);
  });

  it("clamps the global cap", () => {
    expect(clampParticleCap(9)).toBe(20);
    expect(clampParticleCap(9999)).toBe(MAX_PARTICLES);
    expect(clampParticleCap(400)).toBe(400);
  });
});

describe("string path", () => {
  it("is a chord when sag is off, and droops when sag is on", () => {
    expect(stringSegs(0)).toBe(1);
    expect(stringSegs(1)).toBe(8);
    expect(stringPoint(0, 0, 0, 10, 0, 0, 0.5, 0)).toEqual([5, 0, 0]);
    const sag = stringPoint(0, 0, 0, 10, 0, 0, 0.5, 1);
    expect(sag[0]).toBeCloseTo(5, 5);
    expect(sag[1]).toBeLessThan(-1);
  });
});

describe("magnetPair", () => {
  it("uses the type slider for peers and the cross slider otherwise", () => {
    const mag = { lan: 0.8, internet: -0.5 };
    expect(magnetPair("lan", "lan", mag, 0.2)).toBe(0.8);
    expect(magnetPair("lan", "internet", mag, 0.2)).toBe(0.2);
    expect(magnetPair("lan", "internet", mag, -1)).toBe(-1);
  });
});

describe("easePhysToward", () => {
  const zero = {
    magnetSelf: 0, magnetGateway: 0, magnetLan: 0, magnetLocal: 0,
    magnetInternet: 0, magnetMulticast: 0, magnetCross: 0, magnetRange: 1,
    gravity: 0, swirl: 0, chargeAmt: 1, spring: 1, linkSpan: 1, drag: 0.4,
    centerPull: 1, stringAmt: 0,
  };

  it("covers the layout magnets and forces", () => {
    expect(PHYS_EASE_KEYS).toContain("gravity");
    expect(PHYS_EASE_KEYS).toContain("swirl");
    expect(PHYS_EASE_KEYS).toContain("stringAmt");
    expect(PHYS_EASE_KEYS).toContain("magnetLan");
    for (const { key } of MAGNET_FIELDS) expect(PHYS_EASE_KEYS).toContain(key);
  });

  it("chases the target without overshooting, then snaps", () => {
    const live = pickPhys(zero);
    const want = { ...zero, gravity: 1.5, swirl: 0.8, stringAmt: 1, magnetLan: -0.6 };
    expect(easePhysToward(live, want, 0.05)).toBe(true);
    expect(live.gravity).toBeGreaterThan(0);
    expect(live.gravity).toBeLessThan(1.5);
    expect(live.magnetLan).toBeLessThan(0);
    for (let i = 0; i < 80; i++) easePhysToward(live, want, 0.05);
    expect(live.gravity).toBeCloseTo(1.5, 3);
    expect(live.swirl).toBeCloseTo(0.8, 3);
    expect(live.stringAmt).toBeCloseTo(1, 3);
    expect(easePhysToward(live, want, 0.05)).toBe(false);
  });
});
