import { describe, expect, it } from "vitest";
import type { VizTalkerSample } from "../../../sdk/viz-contract";
import { AquariumSim, parseAquariumOptions } from "./aquarium";
import { ANEMONE_SPOT, FRESH_TRAITS, REEF_TRAITS, SPECIES_PROFILES, stepSchool, TANK, type SwimFish, type SwimWorld } from "./fish-behaviour";

function fish(i: number, species: number, x = 0, z = 0): SwimFish {
  return { id: `f${i}`, species, vigor: 0.5, x, y: 0.2, z, yaw: i * 0.7, speed: 0.1, vy: 0, turnRate: 0,
    phase: 0, mood: "cruise", moodT: 0, wander: 0, plant: 0, rs: 1234 + i * 77 };
}
const world = (o: Partial<SwimWorld> = {}): SwimWorld => ({ reef: false, temperament: 0.4, food: null, cursor: null, motion: 1, ...o });
const run = (school: SwimFish[], w: SwimWorld, secs: number, each?: () => void) => {
  for (let i = 0; i < secs * 60; i++) { stepSchool(school, w, 1 / 60); each?.(); }
};

describe("fish behaviour", () => {
  it("roams the tank instead of holding one spot", () => {
    const school = [0, 1, 2, 5].map((s, i) => fish(i, s, (i - 1.5) * 0.3, 0));
    const seen = school.map(() => ({ x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, path: 0 }));
    let prev = school.map((f) => [f.x, f.z]);
    run(school, world(), 60, () => {
      school.forEach((f, i) => {
        const s = seen[i]!;
        s.x0 = Math.min(s.x0, f.x); s.x1 = Math.max(s.x1, f.x); s.z0 = Math.min(s.z0, f.z); s.z1 = Math.max(s.z1, f.z);
        s.path += Math.hypot(f.x - prev[i]![0]!, f.z - prev[i]![1]!);
      });
      prev = school.map((f) => [f.x, f.z]);
    });
    for (const s of seen) {
      expect(s.path).toBeGreaterThan(3);
      expect((s.x1 - s.x0) * (s.z1 - s.z0)).toBeGreaterThan(0.3);
    }
  });

  it("swims nose first and stays inside the glass", () => {
    const school = Array.from({ length: 12 }, (_, i) => fish(i, i % 7, (i % 4) * 0.4 - 0.6, Math.floor(i / 4) * 0.4 - 0.5));
    let back = 0, steps = 0;
    for (let k = 0; k < 1800; k++) {
      const before = school.map((f) => [f.x, f.z]);
      stepSchool(school, world(), 1 / 60);
      school.forEach((f, i) => {
        const dx = f.x - before[i]![0]!, dz = f.z - before[i]![1]!;
        if (dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw) < -1e-6) back++;
        steps++;
        expect(f.x).toBeGreaterThanOrEqual(TANK.xMin); expect(f.x).toBeLessThanOrEqual(TANK.xMax);
        expect(f.z).toBeGreaterThanOrEqual(TANK.zMin); expect(f.z).toBeLessThanOrEqual(TANK.zMax);
        expect(f.y).toBeGreaterThanOrEqual(TANK.yMin); expect(f.y).toBeLessThanOrEqual(TANK.yMax);
      });
    }
    expect(back / steps).toBe(0);
  });

  it("reports the real yaw rate it turned by, bounded by the species turn limit", () => {
    const school = [fish(0, 0), fish(1, 4)];
    let maxAbs = 0;
    for (let k = 0; k < 600; k++) {
      const y0 = school.map((f) => f.yaw);
      stepSchool(school, world(), 1 / 60);
      school.forEach((f, i) => {
        const d = Math.atan2(Math.sin(f.yaw - y0[i]!), Math.cos(f.yaw - y0[i]!));
        if (Math.abs(d) < 0.5) expect(f.turnRate).toBeCloseTo(d * 60, 3);
        maxAbs = Math.max(maxAbs, Math.abs(f.turnRate));
      });
    }
    expect(maxAbs).toBeGreaterThan(0.3);
    expect(maxAbs).toBeLessThan(FRESH_TRAITS[0]!.turn * 2.2 * 2.4 * 1.2); // dart × corner boost × vigor
  });

  it("schools: neons align headings, loners do not need to", () => {
    const neons = Array.from({ length: 6 }, (_, i) => fish(i, 0, (i % 3) * 0.12, Math.floor(i / 3) * 0.12));
    run(neons, world({ temperament: 0 }), 20);
    const ax = neons.reduce((s, f) => s + Math.sin(f.yaw), 0) / neons.length;
    const az = neons.reduce((s, f) => s + Math.cos(f.yaw), 0) / neons.length;
    expect(Math.hypot(ax, az)).toBeGreaterThan(0.5);
  });

  it("keeps personal space", () => {
    const school = Array.from({ length: 10 }, (_, i) => fish(i, 0, 0.01 * i, 0));
    run(school, world(), 15);
    let close = 0;
    for (const a of school) for (const b of school) if (a !== b && Math.hypot(a.x - b.x, a.z - b.z, a.y - b.y) < 0.03) close++;
    expect(close).toBeLessThanOrEqual(2);
  });

  it("goes for food and scatters from the cursor when shy", () => {
    const school = [fish(0, 1, -0.8, -0.7), fish(1, 5, 0.8, -0.7)];
    const food = { x: 0, y: 0.5, z: 0.4 };
    const d0 = school.map((f) => Math.hypot(f.x - food.x, f.z - food.z));
    run(school, world({ food }), 8);
    school.forEach((f, i) => expect(Math.hypot(f.x - food.x, f.z - food.z)).toBeLessThan(d0[i]! * 0.5));
    expect(school.every((f) => f.mood === "feed")).toBe(true);

    const neon = fish(0, 0, 0, 0);
    neon.yaw = 0;
    const cursor = { x: 0, y: 0.2, z: 0.2 };
    stepSchool([neon], world({ cursor }), 1 / 60);
    expect(neon.mood).toBe("flee");
    run([neon], world({ cursor }), 1);
    expect(Math.hypot(neon.x - cursor.x, neon.z - cursor.z)).toBeGreaterThan(0.3);
  });

  it("species move differently and rest, dart and visit plants over time", () => {
    expect(new Set(FRESH_TRAITS.map((t) => t.speed)).size).toBeGreaterThan(4);
    expect(new Set(REEF_TRAITS.map((t) => t.speed)).size).toBeGreaterThan(4);
    const school = Array.from({ length: 14 }, (_, i) => fish(i, i % 7, (i % 5) * 0.3 - 0.6, Math.floor(i / 5) * 0.4 - 0.4));
    const moods = new Set<string>();
    run(school, world(), 120, () => school.forEach((f) => moods.add(f.mood)));
    for (const m of ["cruise", "rest", "dart", "forage"]) expect(moods.has(m), m).toBe(true);
    const cory = school.filter((f) => f.species === 3);
    for (const c of cory) expect(c.y).toBeLessThan(-0.2);
  });
});

describe("aquarium sim feeds the host real motion", () => {
  it("moves slotted fish around and exposes turn rate + phase per slot", () => {
    const talkers: VizTalkerSample[] = Array.from({ length: 5 }, (_, i) => ({ id: `10.0.0.${i}`, rate: 20 + i * 30, role: "lan" }));
    const sim = new AquariumSim(parseAquariumOptions({ preset: "planted", fishCount: "5" }));
    const start: number[] = [];
    let turned = 0;
    for (let i = 0; i < 1800; i++) {
      sim.advance({ t: i / 60, dt: 1 / 60, audio: 0, talkers, packets: [], demo: false });
      if (i === 0) for (let k = 0; k < 20; k++) start.push(sim.slot1[k]!);
      turned += sim.fishMotion().turn.reduce((s, r) => s + Math.abs(r), 0);
    }
    const m = sim.fishMotion();
    expect(m.turn.length).toBe(5);
    expect(m.phase.every((p) => p > 1)).toBe(true);
    expect(turned).toBeGreaterThan(10);
    let moved = 0;
    for (let f = 0; f < 5; f++) moved += Math.hypot(sim.slot1[f * 4]! - start[f * 4]!, sim.slot1[f * 4 + 2]! - start[f * 4 + 2]!);
    expect(moved / 5).toBeGreaterThan(0.2);
  });

});

describe("smooth, natural swimming", () => {
  // the hardest a fish may ever turn: fastest species x dart / flee x the wall boost x top vigour
  const maxRate = (sp: number, reef: boolean) => (reef ? REEF_TRAITS : FRESH_TRAITS)[sp]!.turn * 2.2 * 2.4 * (0.85 + 0.5 * 0.3);

  it("never changes heading faster than its turn rate, and never flips direction in a frame", () => {
    const school = [0, 0, 0, 1, 2, 3, 4, 5, 6].map((s, i) => fish(i, s, (i - 4) * 0.2, (i % 3) * 0.2 - 0.3));
    const dt = 1 / 60;
    let prevYaw = school.map((f) => f.yaw);
    let prevRate = school.map(() => 0);
    let worstRatio = 0;
    let worstAccel = 0;
    run(school, world({ temperament: 0.8 }), 90, () => {
      school.forEach((f, i) => {
        const d = Math.atan2(Math.sin(f.yaw - prevYaw[i]!), Math.cos(f.yaw - prevYaw[i]!));
        worstRatio = Math.max(worstRatio, Math.abs(d) / dt / maxRate(f.species, false));
        // yaw rate eases: no instant reversal from hard left to hard right
        worstAccel = Math.max(worstAccel, Math.abs(f.turnRate - prevRate[i]!) / maxRate(f.species, false));
      });
      prevYaw = school.map((f) => f.yaw);
      prevRate = school.map((f) => f.turnRate);
    });
    expect(worstRatio).toBeLessThanOrEqual(1 + 1e-6);
    // at most ~8 x max rate per second of angular acceleration → < 0.14 of the max rate per frame
    expect(worstAccel).toBeLessThan(0.15);
  });

  it("bursts and glides: speed rises and falls smoothly, the tail beat slows while gliding", () => {
    const school = [fish(0, 2, 0, 0)];
    let glides = 0, bursts = 0, last: boolean | undefined;
    let maxDv = 0, prevV = school[0]!.speed;
    let glidePhaseRate = 0, burstPhaseRate = 0, gN = 0, bN = 0, prevPhase = 0;
    run(school, world(), 40, () => {
      const f = school[0]!;
      if (f.gliding !== last && f.gliding !== undefined) { if (f.gliding) glides++; else bursts++; last = f.gliding; }
      maxDv = Math.max(maxDv, Math.abs(f.speed - prevV)); prevV = f.speed;
      const pr = (f.phase - prevPhase) * 60; prevPhase = f.phase;
      if (f.gliding) { glidePhaseRate += pr; gN++; } else { burstPhaseRate += pr; bN++; }
    });
    expect(glides).toBeGreaterThan(5);
    expect(bursts).toBeGreaterThan(5);
    expect(maxDv).toBeLessThan(0.02);
    expect(glidePhaseRate / gN).toBeLessThan((burstPhaseRate / bN) * 0.5);
  });

  it("holds each species' depth band (cory low, betta high)", () => {
    const school = [fish(0, 3, -0.3, 0), fish(1, 6, 0.3, 0)];
    let coryY = 0, bettaY = 0, n = 0;
    run(school, world(), 60, () => { coryY += school[0]!.y; bettaY += school[1]!.y; n++; });
    expect(coryY / n).toBeLessThan(-0.3);
    expect(bettaY / n).toBeGreaterThan(coryY / n + 0.5);
  });

  describe("species profiles", () => {
    it("every species has a profile, tail beat and glide timing", () => {
      for (const t of [...FRESH_TRAITS, ...REEF_TRAITS]) {
        expect(t.profile).toBeTruthy();
        expect(t.beat).toBeGreaterThan(1);
        expect(t.glide?.length).toBe(4);
      }
      expect(SPECIES_PROFILES.fresh.map((p) => p.profile)).toEqual(["school", "hover", "roam", "bottom", "hover", "territorial", "territorial"]);
      // small schooling fish beat faster than hoverers
      expect(FRESH_TRAITS[0]!.beat!).toBeGreaterThan(FRESH_TRAITS[1]!.beat! * 2);
    });

    it("neon tetras shoal tighter than guppies", () => {
      const spread = (sp: number) => {
        const school = Array.from({ length: 8 }, (_, i) => fish(i, sp, (i % 4) * 0.3 - 0.45, Math.floor(i / 4) * 0.3 - 0.3));
        let acc = 0, k = 0;
        run(school, world({ temperament: 0 }), 40, () => {
          if (++k % 30) return;
          const cx = school.reduce((a, f) => a + f.x, 0) / 8, cz = school.reduce((a, f) => a + f.z, 0) / 8;
          acc += school.reduce((a, f) => a + Math.hypot(f.x - cx, f.z - cz), 0) / 8;
        });
        return acc;
      };
      expect(spread(0)).toBeLessThan(spread(2));
    });

    it("clownfish keep near the anemone", () => {
      const school = [0, 1].map((i) => fish(i, 0, -0.5 + i * 0.2, -0.3));
      for (const f of school) f.aggr = false;
      let near = 0, n = 0;
      run(school, world({ reef: true }), 60, () => {
        n++;
        for (const f of school) if (Math.hypot(f.x - ANEMONE_SPOT[0], f.z - ANEMONE_SPOT[1]) < 0.4) near++;
      });
      expect(near / (n * 2)).toBeGreaterThan(0.6);
    });

    it("corydoras keep to the substrate but sometimes dash up", () => {
      const school = Array.from({ length: 4 }, (_, i) => fish(i, 3, i * 0.2 - 0.3, 0));
      let low = 0, n = 0, top = -Infinity;
      run(school, world(), 240, () => {
        for (const f of school) { n++; if (f.y < TANK.yMin + (TANK.yMax - TANK.yMin) * 0.3) low++; top = Math.max(top, f.y); }
      });
      expect(low / n).toBeGreaterThan(0.7);
      expect(top).toBeGreaterThan(TANK.yMin + (TANK.yMax - TANK.yMin) * 0.5);
    });

    it("bettas patrol a home zone", () => {
      const f = fish(0, 6, 0.6, 0.3);
      f.aggr = true; f.home = 0;
      let d = 0, n = 0;
      run([f], world(), 60, () => { n++; d += Math.hypot(f.x - -0.45, f.z - -0.25); });
      expect(d / n).toBeLessThan(0.55);
    });
  });
});
