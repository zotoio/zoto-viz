import { describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "./scene";
import {
  applyTrafficNeighbours,
  clampParticleCap,
  edgeBend,
  edgeUndulate,
  edgeUndulateOrdered,
  easePhysToward,
  hottestTrafficKeys,
  MAGNET_FIELDS,
  magnetPair,
  MAX_PARTICLES,
  particlesOnLink,
  PHYS_EASE_KEYS,
  pickPhys,
  edgeDrawSegs,
  organicEdgePoint,
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

  it("pins a flexible edge to both nodes and bows with their pull", () => {
    expect(edgeDrawSegs(0)).toBe(14);
    expect(edgeDrawSegs(1)).toBe(20);
    const ends = organicEdgePoint(0, 0, 0, 10, 0, 0, 0, 0, 4, 0);
    const tail = organicEdgePoint(0, 0, 0, 10, 0, 0, 1, 0, 4, 0);
    expect(ends).toEqual([0, 0, 0]);
    expect(tail).toEqual([10, 0, 0]);
    const still = organicEdgePoint(0, 0, 0, 10, 0, 0, 0.5, 0, 0, 0);
    expect(still[0]).toBeCloseTo(5, 4);
    expect(still[1]).toBeCloseTo(0, 4);
    expect(still[2]).toBeCloseTo(0, 4);
    const pulled = organicEdgePoint(0, 0, 0, 10, 0, 0, 0.5, 0, 3, 0);
    expect(pulled[1]).toBeGreaterThan(still[1] + 1);
    const away = organicEdgePoint(10, 0, 0, 20, 0, 0, 0.5, 8, 0, 0);
    expect(away[0]).toBeLessThan(14);
    expect(organicEdgePoint(10, 0, 0, 20, 0, 0, 0, 8, 0, 0)).toEqual([10, 0, 0]);
    expect(organicEdgePoint(10, 0, 0, 20, 0, 0, 1, 8, 0, 0)).toEqual([20, 0, 0]);
    const towardHub = organicEdgePoint(0, 0, 0, 10, 0, 0, 0.5, 8, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5, 10, 0);
    expect(towardHub[1]).toBeGreaterThan(1);
    const sideways = organicEdgePoint(10, 0, 0, 20, 0, 0, 0.5, 0, 40, 0);
    expect(sideways[0]).toBeCloseTo(15, 1);
    expect(sideways[1]).toBeGreaterThan(4);
  });

  it("pulls the midpoint toward a hub when bundling", () => {
    expect(stringSegs(0, 0.8)).toBeGreaterThan(1);
    const mid = stringPoint(0, 0, 0, 10, 0, 0, 0.5, 0, 0, 0, 40, 0, 1);
    expect(mid[1]).toBeGreaterThan(10);
    expect(mid[0]).toBeLessThan(4);
  });
});

describe("highest-traffic neighbours", () => {
  const body = (key: number, rate: number, x: number) => ({ key, rate, x, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

  it("keeps the leader and peers at least half as busy", () => {
    const keys = hottestTrafficKeys([
      body(1, 100, 0), body(2, 60, 10), body(3, 40, 20), body(4, 0, 30),
    ]);
    expect([...keys].sort()).toEqual([1, 2]);
  });

  it("attracts a neighbour toward the hot node and ignores a cold edge", () => {
    const hot = body(1, 100, 0);
    const near = body(2, 10, 40);
    const coldA = body(3, 1, 0);
    const coldB = body(4, 1, 40);
    const links = [{ source: hot, target: near }, { source: coldA, target: coldB }];
    applyTrafficNeighbours(links, hottestTrafficKeys([hot, near, coldA, coldB]), 1, 1);
    expect(near.vx).toBeLessThan(0);
    expect(hot.vx).toBeGreaterThan(0);
    expect(coldA.vx).toBe(0);
    expect(coldB.vx).toBe(0);
  });

  it("repels the neighbour away from the hot node", () => {
    const hot = body(1, 100, 0);
    const near = body(2, 5, 40);
    applyTrafficNeighbours([{ source: hot, target: near }], new Set([1]), -1, 1);
    expect(near.vx).toBeGreaterThan(0);
    expect(hot.vx).toBeLessThan(0);
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
    magnetInternet: 0, magnetMulticast: 0, magnetCross: 0, magnetRange: 1, magnetTraffic: 0,
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

describe("edge undulation: live cables, not rods", () => {
  const A: [number, number, number] = [0, 0, 0];
  const B: [number, number, number] = [120, 10, 30];
  const len = Math.hypot(120, 10, 30);
  const cap = Math.min(len * 0.045, 9);
  const at = (t: number, time: number, seed = 0.37, amt = 1) => edgeUndulate(...A, ...B, t, time, seed, amt);
  const mag = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2]);

  it("is on by default", () => {
    expect(DEFAULT_DREAM.edgeUndulate).toBeGreaterThan(0);
  });

  it("keeps both ends on their nodes, and is still at 0", () => {
    for (const time of [0, 1.3, 7.9]) {
      expect(mag(at(0, time))).toBeLessThan(1e-9);
      expect(mag(at(1, time))).toBeLessThan(1e-9);
      expect(mag(at(0.5, time, 0.37, 0))).toBe(0);
    }
  });

  it("stays inside its amplitude and moves across the cable, not along it", () => {
    const ex = 120 / len, ey = 10 / len, ez = 30 / len;
    for (let time = 0; time < 12; time += 0.37) {
      for (const t of [0.2, 0.5, 0.8]) {
        const d = at(t, time);
        expect(mag(d)).toBeLessThanOrEqual(cap + 1e-9);
        expect(Math.abs(d[0] * ex + d[1] * ey + d[2] * ez)).toBeLessThan(1e-9);
      }
    }
  });

  it("moves slowly and smoothly: small per frame, visible over seconds", () => {
    let maxStep = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let prev = at(0.5, 0);
    for (let f = 1; f <= 6 * 60; f++) {
      const d = at(0.5, f / 60);
      maxStep = Math.max(maxStep, Math.hypot(d[0] - prev[0], d[1] - prev[1], d[2] - prev[2]));
      const s = d[0] + d[1] + d[2];
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
      prev = d;
    }
    expect(maxStep).toBeLessThan(cap * 0.03);
    expect(hi - lo).toBeGreaterThan(cap * 0.5);
  });

  it("sways each edge out of step with its neighbours, and draws one cable in either direction", () => {
    const s1 = edgeBend("cpu1", "zoto");
    const s2 = edgeBend("cpu2", "zoto");
    const d1 = at(0.5, 3.2, s1);
    const d2 = at(0.5, 3.2, s2);
    expect(Math.hypot(d1[0] - d2[0], d1[1] - d2[1], d1[2] - d2[2])).toBeGreaterThan(cap * 0.05);
    // arrows draw in the traffic direction: same cable when the ends arrive swapped
    const fwd = edgeUndulateOrdered(...A, ...B, 0.3, 2.1, s1, 1, true);
    const rev = edgeUndulateOrdered(...B, ...A, 0.7, 2.1, s1, 1, false);
    for (let k = 0; k < 3; k++) expect(rev[k]).toBeCloseTo(fwd[k]!, 9);
  });

  it("stays continuous when one node crosses the other (no flip from a position-based end order)", () => {
    let prev: [number, number, number] | null = null;
    let biggest = 0;
    for (let bx = 5; bx >= -5; bx -= 0.1) {
      const d = edgeUndulateOrdered(0, 0, 0, bx, 0, 60, 0.3, 4.2, 0.61, 1, true);
      if (prev) biggest = Math.max(biggest, Math.hypot(d[0] - prev[0], d[1] - prev[1], d[2] - prev[2]));
      prev = d;
    }
    expect(biggest).toBeLessThan(0.05);
  });
});
