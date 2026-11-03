import { describe, expect, it } from "vitest";
import type { VizTalkerSample } from "../../../sdk/viz-contract";
import { AQU_PUFF_SLOT2, AquariumSim, parseAquariumOptions } from "./aquarium";
import {
  EAT_MIN_INTERVAL, HATCH_GROW, PUFF_LIFE, RESPAWN_MIN, TANK, TERRITORY_SPOTS,
  canEat, fishBody, isAggressive, newSchoolState, puffStrength, stepSchool, swimBox,
  type SwimFish, type SwimWorld,
} from "./fish-behaviour";

function fish(id: string, species: number, x = 0, z = 0, yaw = 0): SwimFish {
  return { id, species, vigor: 0.5, x, y: 0.1, z, yaw, speed: 0.1, vy: 0, turnRate: 0,
    phase: 0, mood: "cruise", moodT: 0, wander: 0, plant: 0, rs: 99 + id.length * 31 + Math.round(x * 1000) };
}
const world = (o: Partial<SwimWorld> = {}): SwimWorld => ({ reef: false, temperament: 0.4, food: null, cursor: null, motion: 1, ...o });
const step = (school: SwimFish[], w: SwimWorld, secs: number, each?: (k: number) => void) => {
  for (let i = 0; i < secs * 60; i++) { stepSchool(school, w, 1 / 60); each?.(i); }
};
/** An id that makes this species' fish territorial (or not). */
function idFor(species: number, aggressive: boolean, tag: string): string {
  for (let i = 0; i < 5000; i++) {
    const f = fish(`${tag}${i}`, species);
    if (isAggressive(f, false) === aggressive) return f.id;
  }
  throw new Error("no id");
}

describe("containment: the whole body stays in the glass", () => {
  it("keeps nose, tail, back and belly of every species inside, with a size-aware margin", () => {
    const school = Array.from({ length: 14 }, (_, i) => fish(`c${i}`, i % 7, (i % 4) * 0.5 - 0.75, Math.floor(i / 4) * 0.4 - 0.6, i));
    let worst = Infinity;
    step(school, world({ temperament: 0.9 }), 90, () => {
      for (const f of school) {
        const b = fishBody(f.species, false);
        worst = Math.min(worst,
          f.x - b.halfLen - TANK.xMin, TANK.xMax - f.x - b.halfLen,
          f.z - b.halfLen - TANK.zMin, TANK.zMax - f.z - b.halfLen,
          f.y - b.halfH - TANK.yMin, TANK.yMax - f.y - b.halfH);
      }
    });
    // every body keeps clear water to the glass, gravel and lid
    expect(worst).toBeGreaterThan(0);
  }, 30_000);

  it("gives bigger fish a bigger margin", () => {
    const neon = swimBox(0, false), discus = swimBox(4, false);
    expect(discus.xMax).toBeLessThan(neon.xMax - 0.05);
    expect(discus.yMax).toBeLessThan(neon.yMax - 0.05);
    expect(fishBody(4, false).halfLen).toBeGreaterThan(fishBody(0, false).halfLen * 3);
  });
});

describe("corners", () => {
  it("a fish pushed nose-first into each corner gets out and keeps roaming", () => {
    for (const sp of [0, 1, 4, 5]) {
      const b = swimBox(sp, false);
      for (const [cx, cz] of [[b.xMin, b.zMin], [b.xMax, b.zMin], [b.xMin, b.zMax], [b.xMax, b.zMax]]) {
        const f = fish(`k${sp}${cx}${cz}`, sp, cx!, cz!, Math.atan2(cx!, cz!)); // facing into the corner
        const school = [f];
        let cornerT = 0;
        step(school, world(), 30, () => {
          const near = Math.min(f.x - b.xMin, b.xMax - f.x) < 0.15 && Math.min(f.z - b.zMin, b.zMax - f.z) < 0.15;
          if (near) cornerT += 1 / 60;
        });
        expect(cornerT, `species ${sp} corner ${cx},${cz}`).toBeLessThan(4);
        expect(Math.hypot(f.x - cx!, f.z - cz!)).toBeGreaterThan(0.3);
      }
    }
  }, 30_000);

  it("over a long run no fish spends long in a corner", () => {
    const school = Array.from({ length: 12 }, (_, i) => fish(`r${i}`, i % 7, (i % 4) * 0.4 - 0.6, Math.floor(i / 4) * 0.4 - 0.6, i * 0.9));
    const inCorner = school.map(() => 0);
    step(school, world(), 180, () => school.forEach((f, i) => {
      const b = swimBox(f.species, false);
      if (Math.min(f.x - b.xMin, b.xMax - f.x) < 0.12 && Math.min(f.z - b.zMin, b.zMax - f.z) < 0.12) inCorner[i]! += 1 / 60;
    }));
    for (const t of inCorner) expect(t).toBeLessThan(180 * 0.05);
  }, 30_000);

  it("a fish that stops making progress is kicked out", () => {
    const f = fish("stuck", 5, 0.2, 0.1);
    f.mood = "cruise";
    // Pin it: every step put it back, as if wedged behind a rock.
    let kicked = false;
    for (let i = 0; i < 180; i++) {
      stepSchool([f], world(), 1 / 60);
      if ((f.mood as string) === "dart" && f.goalX !== undefined) kicked = true;
      f.x = 0.2; f.z = 0.1;
    }
    expect(kicked).toBe(true);
  });
});

describe("aggression", () => {
  it("some individuals of a species are territorial and peaceful species never are", () => {
    const cichlids = Array.from({ length: 40 }, (_, i) => isAggressive(fish(`ci${i}`, 5), false));
    expect(cichlids.filter(Boolean).length).toBeGreaterThan(20);
    expect(cichlids.filter(Boolean).length).toBeLessThan(40);
    expect(Array.from({ length: 40 }, (_, i) => isAggressive(fish(`ne${i}`, 0), false)).some(Boolean)).toBe(false);
  });

  it("a guard chases and nips an intruder off its territory; the intruder flees", () => {
    const g = fish(idFor(5, true, "g"), 5);
    isAggressive(g, false);
    const home = TERRITORY_SPOTS[g.home!]!;
    g.x = home[0]; g.z = home[2]; g.y = home[1] + 0.15; g.mood = "guard"; g.moodT = 30;
    const intruder = fish("neon-in", 0, home[0] + 0.15, home[2] + 0.1);
    const school = [g, intruder];
    const moods = new Set<string>();
    let fled = false, maxIntruderD = 0;
    step(school, world(), 20, () => {
      moods.add(g.mood);
      if (intruder.mood === "flee") fled = true;
      maxIntruderD = Math.max(maxIntruderD, Math.hypot(intruder.x - home[0], intruder.z - home[2]));
    });
    expect(moods.has("chase")).toBe(true);
    expect(fled).toBe(true);
    expect(maxIntruderD).toBeGreaterThan(0.45);
  }, 30_000);

  it("is visible but not frantic: chases are spaced by a cooldown", () => {
    const g = fish(idFor(5, true, "h"), 5);
    isAggressive(g, false);
    const others = Array.from({ length: 6 }, (_, i) => fish(`o${i}`, 0, (i - 3) * 0.2, 0));
    const school = [g, ...others];
    let starts = 0, prev = g.mood;
    step(school, world(), 120, () => { if (g.mood === "chase" && prev !== "chase") starts++; prev = g.mood; });
    expect(starts).toBeGreaterThan(0);
    expect(starts).toBeLessThan(120 / 5);
  }, 30_000);
});

describe("predation", () => {
  const tank = () => {
    const pred = fish(idFor(5, true, "p"), 5, 0, -0.2);
    const prey = Array.from({ length: 6 }, (_, i) => fish(`prey${i}`, 0, (i - 3) * 0.25, 0.1 + (i % 2) * 0.2));
    return { pred, school: [pred, ...prey] };
  };

  it("only a much bigger fish can eat", () => {
    expect(canEat(fish("a", 5), fish("b", 0), false)).toBe(true);
    expect(canEat(fish("a", 0), fish("b", 5), false)).toBe(false);
    expect(canEat(fish("a", 5), fish("b", 5), false)).toBe(false);
  });

  it("is rate limited, removes the prey, leaves a fading puff and respawns it", () => {
    const { school } = tank();
    const st = newSchoolState(0);
    const w = world({ state: st });
    const eatTimes: number[] = [];
    let last = 0;
    let respawned = 0;
    const eatenAt = new Map<string, number>();
    step(school, w, 400, (k) => {
      if (st.eats > last) { eatTimes.push(k / 60); last = st.eats; }
      for (const f of school) {
        if (f.eaten && !eatenAt.has(f.id)) eatenAt.set(f.id, k / 60);
        if (!f.eaten && eatenAt.has(f.id)) {
          expect(k / 60 - eatenAt.get(f.id)!).toBeGreaterThanOrEqual(RESPAWN_MIN - 0.1);
          expect(f.grow).toBeLessThan(0.5);
          eatenAt.delete(f.id); respawned++;
        }
      }
    });
    expect(eatTimes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < eatTimes.length; i++) expect(eatTimes[i]! - eatTimes[i - 1]!).toBeGreaterThanOrEqual(EAT_MIN_INTERVAL - 0.1);
    // a few minutes apart at most
    for (let i = 1; i < eatTimes.length; i++) expect(eatTimes[i]! - eatTimes[i - 1]!).toBeLessThan(240);
    expect(respawned).toBeGreaterThanOrEqual(1);
    expect(school.filter((f) => !f.eaten).length).toBeGreaterThanOrEqual(school.length - 1);
  }, 30_000);

  it("a hatched fish grows back to full size", () => {
    const { school } = tank();
    const st = newSchoolState(0);
    const w = world({ state: st });
    let hatched: SwimFish | undefined;
    step(school, w, 200, () => { hatched ??= school.find((f) => f.grow !== undefined && f.grow < 1 && !f.eaten); });
    expect(hatched).toBeDefined();
    step(school, w, HATCH_GROW + 0.5);
    expect(hatched!.grow).toBe(1);
  }, 30_000);

  it("the puff blooms then fades to nothing", () => {
    expect(puffStrength(0)).toBe(0);
    expect(puffStrength(0.4)).toBeGreaterThan(0.7);
    let prev = puffStrength(0.5);
    for (let t = 0.6; t < PUFF_LIFE; t += 0.25) { const k = puffStrength(t); expect(k).toBeLessThan(prev); prev = k; }
    expect(puffStrength(PUFF_LIFE)).toBe(0);
    expect(puffStrength(PUFF_LIFE + 3)).toBe(0);
  });

  it("the sim hides an eaten fish from the host and writes the puff into slot 2", () => {
    const talkers: VizTalkerSample[] = Array.from({ length: 10 }, (_, i) => ({ id: `talker-${i * 7919}-${i}`, rate: 30 + i * 20, role: "device" }));
    const sim = new AquariumSim(parseAquariumOptions({ preset: "planted", fishCount: "10" }));
    sim.school.eatCool = 0;
    let sawPuff = false, sawHidden = false;
    for (let i = 0; i < 60 * 240 && !(sawPuff && sawHidden); i++) {
      const p = sim.advance({ t: i / 60, dt: 1 / 60, audio: 0, talkers, packets: [], demo: false });
      if (p.slot2[AQU_PUFF_SLOT2 + 3]! > 0.05) sawPuff = true;
      if (sim.visibleFishIds().length < sim.slottedFishCount()) {
        sawHidden = true;
        expect(p.slot0[17]).toBe(sim.visibleFishIds().length);
        expect(sim.fishMotion().turn.length).toBe(sim.visibleFishIds().length);
      }
    }
    expect(sawHidden).toBe(true);
    expect(sawPuff).toBe(true);
  }, 30_000);
});
