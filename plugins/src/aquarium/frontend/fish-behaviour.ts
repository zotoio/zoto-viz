/**
 * Rule-based fish behaviour for the aquarium. Each fish is a small steering agent:
 * wander + school (separation / alignment / cohesion with its own species) + wall look-ahead
 * + plant visits + food + cursor, with rest and dart moods. Fish only ever move along their
 * nose (yaw) so they never slide sideways or tail-first; the yaw change per step is the real
 * turn rate the host uses to bend the HD spine.
 */

export type FishMood = "cruise" | "rest" | "dart" | "forage" | "feed" | "flee" | "inspect" | "guard" | "chase";

export interface FishTraits {
  /** Cruise speed, tank units / s. */
  speed: number;
  /** Max yaw rate, rad / s, at cruise. */
  turn: number;
  /** 0 loner … 1 tight school. */
  school: number;
  /** Preferred depth band (tank y). */
  yMin: number;
  yMax: number;
  /** Chance per second of a dart burst. */
  dart: number;
  /** Chance per second of a rest. */
  rest: number;
  /** Chance per second of going to a plant. */
  plant: number;
  /** -1 flees the cursor … +1 comes to look. */
  curious: number;
  /** Wander noise. */
  jitter: number;
  /** Share of this species' individuals that are territorial (guard a spot, chase and nip intruders). */
  aggro: number;
}

/** Freshwater: neon, angel, guppy, cory, discus, cichlid, betta. */
export const FRESH_TRAITS: FishTraits[] = [
  { speed: 0.34, turn: 3.2, school: 1.0, yMin: 0.0, yMax: 0.45, dart: 0.06, rest: 0.01, plant: 0.03, curious: -0.8, jitter: 1.1, aggro: 0 },
  { speed: 0.16, turn: 1.3, school: 0.35, yMin: 0.15, yMax: 0.6, dart: 0.01, rest: 0.05, plant: 0.08, curious: 0.6, jitter: 0.5, aggro: 0.45 },
  { speed: 0.3, turn: 2.8, school: 0.6, yMin: 0.2, yMax: 0.7, dart: 0.08, rest: 0.02, plant: 0.04, curious: 0.3, jitter: 1.3, aggro: 0 },
  { speed: 0.12, turn: 2.0, school: 0.55, yMin: -0.5, yMax: -0.38, dart: 0.03, rest: 0.08, plant: 0.1, curious: -0.2, jitter: 0.9, aggro: 0 },
  { speed: 0.14, turn: 1.1, school: 0.45, yMin: 0.05, yMax: 0.45, dart: 0.01, rest: 0.05, plant: 0.06, curious: 0.4, jitter: 0.4, aggro: 0.25 },
  { speed: 0.24, turn: 2.2, school: 0.1, yMin: -0.35, yMax: 0.25, dart: 0.07, rest: 0.03, plant: 0.06, curious: 0.8, jitter: 0.8, aggro: 0.85 },
  { speed: 0.13, turn: 1.5, school: 0.0, yMin: 0.35, yMax: 0.72, dart: 0.02, rest: 0.07, plant: 0.07, curious: 0.7, jitter: 0.6, aggro: 0.6 },
];

/** Reef: clown, tang, damsel, goby, wrasse, anemone. */
export const REEF_TRAITS: FishTraits[] = [
  { speed: 0.18, turn: 2.4, school: 0.3, yMin: -0.25, yMax: 0.2, dart: 0.03, rest: 0.05, plant: 0.14, curious: 0.5, jitter: 1.0, aggro: 0.6 },
  { speed: 0.3, turn: 1.6, school: 0.7, yMin: 0.1, yMax: 0.65, dart: 0.02, rest: 0.01, plant: 0.03, curious: 0.2, jitter: 0.5, aggro: 0.3 },
  { speed: 0.3, turn: 3.0, school: 0.9, yMin: 0.0, yMax: 0.5, dart: 0.07, rest: 0.01, plant: 0.04, curious: -0.7, jitter: 1.2, aggro: 0.8 },
  { speed: 0.1, turn: 2.2, school: 0.0, yMin: -0.5, yMax: -0.4, dart: 0.06, rest: 0.1, plant: 0.06, curious: -0.4, jitter: 0.9, aggro: 0.1 },
  { speed: 0.34, turn: 2.6, school: 0.4, yMin: -0.1, yMax: 0.5, dart: 0.05, rest: 0.01, plant: 0.03, curious: 0.4, jitter: 1.0, aggro: 0.35 },
  { speed: 0.08, turn: 0.9, school: 0.0, yMin: -0.45, yMax: -0.2, dart: 0.0, rest: 0.15, plant: 0.12, curious: 0.0, jitter: 0.3, aggro: 0 },
];

export function traitsFor(species: number, reef: boolean): FishTraits {
  const t = reef ? REEF_TRAITS : FRESH_TRAITS;
  return t[Math.max(0, Math.min(t.length - 1, Math.round(species)))] ?? t[0]!;
}

/**
 * Tank swim volume: the inside of the glass (x ±1.22, back pane z -1.02, lid y 0.82) above the
 * gravel (top ≈ -0.74). Front stops short of the open front so fish never swim into the lens.
 * These are the limits for the whole body; {@link swimBox} shrinks them by the fish's own size.
 */
export const TANK = { xMin: -1.2, xMax: 1.2, yMin: -0.72, yMax: 0.78, zMin: -1.0, zMax: 0.62 } as const;

/** Host mesh scale of the designer fish (host-mesh-drive uses the same number). */
export const FISH_MESH_SCALE = 1.35;
/** Clear water kept between a fish's body and the glass. */
export const WALL_GAP = 0.03;

/** Measured GLB half-extents (m, before {@link FISH_MESH_SCALE}): nose-to-tail half length, half height. */
const MESH_BODY: Record<string, [number, number]> = {
  neon: [0.018, 0.008], angel: [0.06, 0.076], guppy: [0.02, 0.015], cory: [0.032, 0.023],
  discus: [0.075, 0.06], cichlid: [0.053, 0.025], betta: [0.037, 0.031], clown: [0.04, 0.022],
};
const FRESH_MESH = ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta"];
const REEF_MESH = ["clown", "angel", "neon", "cory", "guppy", "discus"];

/** Half length (any yaw: the horizontal body radius) and half height of a fish in tank units. */
export function fishBody(species: number, reef: boolean): { halfLen: number; halfH: number } {
  const names = reef ? REEF_MESH : FRESH_MESH;
  const n = names[Math.max(0, Math.min(names.length - 1, Math.round(species)))] ?? "neon";
  const b = MESH_BODY[n] ?? MESH_BODY.neon!;
  return { halfLen: b[0] * FISH_MESH_SCALE, halfH: b[1] * FISH_MESH_SCALE };
}

/** Where this fish's centre may go so its whole body (at any heading) stays inside {@link TANK}. */
export function swimBox(species: number, reef: boolean, grow = 1) {
  const b = fishBody(species, reef);
  const r = b.halfLen * grow + WALL_GAP;
  const h = b.halfH * grow + WALL_GAP;
  return { xMin: TANK.xMin + r, xMax: TANK.xMax - r, yMin: TANK.yMin + h, yMax: TANK.yMax - h, zMin: TANK.zMin + r, zMax: TANK.zMax - r };
}

/** Trait depth bands were authored for the old -0.5..0.72 volume; map them onto the real one. */
function bandY(v: number): number {
  return TANK.yMin + 0.04 + ((v + 0.5) / 1.22) * (TANK.yMax - TANK.yMin - 0.1);
}

/** Plant clumps fish visit (x, y, z); matches the pinned plants, all well clear of the glass. */
export const PLANT_SPOTS: readonly [number, number, number][] = [
  [-0.45, -0.45, -0.25], [0.15, -0.42, -0.3], [0.45, -0.45, 0.05], [-0.6, -0.3, -0.55], [0.65, -0.3, -0.55],
];
/** Territories a guarding fish holds: the plants plus the big rock on the gravel. */
export const TERRITORY_SPOTS: readonly [number, number, number][] = [...PLANT_SPOTS, [-0.55, -0.5, 0.05]];

/** Eating is rare: at least this many seconds between two eats in one tank. */
export const EAT_MIN_INTERVAL = 90;
/** Extra random wait on top of {@link EAT_MIN_INTERVAL}. */
export const EAT_JITTER = 60;
/** Seconds the red puff where a fish was eaten takes to clear. */
export const PUFF_LIFE = 4.5;
/** Seconds before an eaten fish hatches again. */
export const RESPAWN_MIN = 25;
/** Seconds a hatched fish takes to grow to full size. */
export const HATCH_GROW = 3;

export interface EatPuff { x: number; y: number; z: number; age: number }

/** Tank-wide state that outlives one step: the eat rate limit and live puffs. */
export interface SchoolState {
  t: number;
  /** Seconds until the next eat is allowed. */
  eatCool: number;
  eats: number;
  puffs: EatPuff[];
}

export function newSchoolState(firstEatAfter = EAT_MIN_INTERVAL): SchoolState {
  return { t: 0, eatCool: firstEatAfter, eats: 0, puffs: [] };
}

/** 0..1 visibility of a puff: a quick bloom, then a slow fade to nothing at {@link PUFF_LIFE}. */
export function puffStrength(age: number): number {
  if (!(age >= 0) || age >= PUFF_LIFE) return 0;
  const rise = Math.min(1, age / 0.35);
  return rise * Math.pow(1 - age / PUFF_LIFE, 1.4);
}

export interface SwimFish {
  id: string;
  species: number;
  vigor: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Forward speed, tank units / s. */
  speed: number;
  vy: number;
  /** Last yaw rate, rad / s (signed). */
  turnRate: number;
  /** Fin / tail phase, advanced by swim speed. */
  phase: number;
  mood: FishMood;
  moodT: number;
  wander: number;
  plant: number;
  /** Per-fish deterministic RNG state. */
  rs: number;
  /** Slow average of the position; a fish that stays near it is stuck. */
  ex?: number;
  ez?: number;
  stuck?: number;
  /** Point a kicked fish heads for (out of a corner). */
  goalX?: number;
  goalZ?: number;
  /** Territorial individual (decided once from the id). */
  aggr?: boolean;
  /** Territory index into TERRITORY_SPOTS. */
  home?: number;
  /** Id of the fish being chased, and whether the chase is a hunt that can end in an eat. */
  target?: string;
  hunt?: boolean;
  /** Seconds before this fish may chase again. */
  cool?: number;
  /** Where a fleeing fish runs from. */
  fleeX?: number;
  fleeZ?: number;
  /** Eaten: hidden until it hatches again. */
  eaten?: boolean;
  respawnT?: number;
  /** 0..1 body size while a hatched fish grows; 1 when grown. */
  grow?: number;
}

export interface SwimWorld {
  reef: boolean;
  temperament: number;
  food: { x: number; y: number; z: number } | null;
  cursor: { x: number; y: number; z: number } | null;
  /** 0..1 global motion scale (reduced motion). */
  motion: number;
  /** Tank-wide state; eating (and respawning) only happens when it is given. */
  state?: SchoolState;
}

export function fishRand(f: SwimFish): number {
  f.rs = (f.rs + 0x6d2b79f5) >>> 0;
  let t = Math.imul(f.rs ^ (f.rs >>> 15), 1 | f.rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function moodSpeed(m: FishMood): number {
  switch (m) {
    case "rest": return 0.18;
    case "dart": return 3.2;
    case "flee": return 2.6;
    case "chase": return 2.1;
    case "feed": return 1.5;
    case "guard": return 0.75;
    case "forage": return 0.7;
    case "inspect": return 0.55;
    default: return 1;
  }
}

function moodTurn(m: FishMood): number {
  return m === "dart" || m === "flee" ? 2.2 : m === "chase" ? 1.8 : m === "rest" ? 0.5 : m === "feed" ? 1.5 : m === "guard" ? 1.1 : 1;
}

function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Whether this individual is territorial: a fixed share of each species, decided by its id. */
export function isAggressive(f: SwimFish, reef: boolean): boolean {
  if (f.aggr === undefined) {
    const h = idHash(f.id);
    f.aggr = h < traitsFor(f.species, reef).aggro;
    f.home = Math.floor(idHash(f.id + "home") * TERRITORY_SPOTS.length);
  }
  return f.aggr;
}

/** A predator must be this many times longer than the fish it eats. */
export const EAT_SIZE_RATIO = 1.8;

export function canEat(pred: SwimFish, prey: SwimFish, reef: boolean): boolean {
  return fishBody(pred.species, reef).halfLen >= fishBody(prey.species, reef).halfLen * EAT_SIZE_RATIO;
}

function pickMood(f: SwimFish, tr: FishTraits, w: SwimWorld, dt: number, aggr: boolean): void {
  f.moodT -= dt;
  if (w.food) {
    if (f.mood !== "feed") { f.mood = "feed"; f.moodT = 2 + fishRand(f) * 2; f.target = undefined; }
    return;
  }
  if (f.mood === "feed") { f.mood = "cruise"; f.moodT = 2; }
  if (f.mood === "chase" || (f.mood === "flee" && f.fleeX !== undefined)) {
    if (f.moodT > 0) return;
    f.target = undefined; f.hunt = false; f.fleeX = undefined; f.fleeZ = undefined;
    f.mood = aggr ? "guard" : "cruise"; f.moodT = 2 + fishRand(f) * 3;
    return;
  }
  if (w.cursor) {
    const d = Math.hypot(w.cursor.x - f.x, w.cursor.y - f.y, w.cursor.z - f.z);
    if (d < 0.55 && tr.curious < -0.1 && f.mood !== "flee") { f.mood = "flee"; f.moodT = 0.8 + fishRand(f) * 0.6; return; }
    if (d < 1.1 && tr.curious > 0.2 && f.mood === "cruise" && fishRand(f) < tr.curious * dt * 2) { f.mood = "inspect"; f.moodT = 2 + fishRand(f) * 2; return; }
  }
  if (f.moodT > 0) return;
  const r = fishRand(f);
  const hot = 0.6 + w.temperament + f.vigor * 0.8;
  // Territorial fish spend about half their time holding their spot.
  if (aggr && r < 0.5) { f.mood = "guard"; f.moodT = 6 + fishRand(f) * 8; return; }
  // Moods are rolled once a second-ish: scale chances by the roll window.
  const win = 1.2;
  const r2 = aggr ? (r - 0.5) * 2 : r;
  if (r2 < tr.dart * hot * win) { f.mood = "dart"; f.moodT = 0.35 + fishRand(f) * 0.4; f.yaw += (fishRand(f) - 0.5) * 1.6; }
  else if (r2 < (tr.dart * hot + tr.rest * (1.4 - w.temperament)) * win) { f.mood = "rest"; f.moodT = 2.5 + fishRand(f) * 4; }
  else if (r2 < (tr.dart * hot + tr.rest + tr.plant) * win) {
    f.mood = "forage"; f.moodT = 3 + fishRand(f) * 4; f.plant = Math.floor(fishRand(f) * PLANT_SPOTS.length);
  } else { f.mood = "cruise"; f.moodT = 1 + fishRand(f) * 1.5; }
}

/** Distance from the body box at which the walls start to push, per unit of speed. */
const WALL_REACH = 0.32;

/**
 * Wall field for a fish at (x, z) in box b: how hard each wall pushes back (0 far … 1 touching),
 * summed into a steering vector, plus how many walls are close (2 = in a corner).
 */
function wallPush(x: number, z: number, b: ReturnType<typeof swimBox>, reach: number): { px: number; pz: number; near: number } {
  let px = 0, pz = 0, near = 0;
  const f = (d: number) => { const k = Math.max(0, 1 - d / reach); return k * k; };
  const dxl = x - b.xMin, dxr = b.xMax - x, dzb = z - b.zMin, dzf = b.zMax - z;
  const kl = f(dxl), kr = f(dxr), kb = f(dzb), kf = f(dzf);
  px += kl - kr; pz += kb - kf;
  for (const k of [kl, kr, kb, kf]) if (k > 0.05) near++;
  return { px, pz, near };
}

function inBox(x: number, z: number, b: ReturnType<typeof swimBox>): boolean {
  return x > b.xMin && x < b.xMax && z > b.zMin && z < b.zMax;
}

/** One fixed step for the whole school. Mutates fish in place. */
export function stepSchool(school: SwimFish[], w: SwimWorld, dt: number): void {
  const motion = Math.max(0.05, Math.min(1, w.motion));
  const st = w.state;
  if (st) {
    st.t += dt;
    st.eatCool = Math.max(0, st.eatCool - dt);
    for (const p of st.puffs) { p.age += dt; p.y += 0.02 * dt; }
    st.puffs = st.puffs.filter((p) => p.age < PUFF_LIFE);
  }
  const byId = new Map<string, SwimFish>();
  for (const f of school) byId.set(f.id, f);
  const live = school.filter((f) => !f.eaten);
  for (const f of school) {
    if (f.eaten) {
      f.respawnT = (f.respawnT ?? RESPAWN_MIN) - dt;
      if (f.respawnT <= 0) hatch(f, w.reef);
      continue;
    }
    if (f.grow !== undefined && f.grow < 1) f.grow = Math.min(1, f.grow + dt / HATCH_GROW);
    const tr = traitsFor(f.species, w.reef);
    const aggr = isAggressive(f, w.reef);
    if (f.cool) f.cool = Math.max(0, f.cool - dt);
    pickMood(f, tr, w, dt, aggr);
    const body = fishBody(f.species, w.reef);
    const box = swimBox(f.species, w.reef, f.grow ?? 1);
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    // Wander: a slowly drifting heading offset ahead of the nose.
    f.wander = wrap(f.wander + (fishRand(f) - 0.5) * tr.jitter * 6 * dt);
    let sx = fx + Math.sin(f.yaw + f.wander) * 0.6;
    let sz = fz + Math.cos(f.yaw + f.wander) * 0.6;
    const bMin = bandY(tr.yMin), bMax = bandY(tr.yMax);
    let ty = (bMin + bMax) / 2 + Math.sin(f.wander * 2 + f.phase * 0.05) * (bMax - bMin) * 0.45;

    // School with same species; keep personal space from everyone.
    let ax = 0, az = 0, cx = 0, cy = 0, cz = 0, n = 0;
    for (const o of live) {
      if (o === f) continue;
      const dx = o.x - f.x, dy = o.y - f.y, dz = o.z - f.z;
      const d2 = dx * dx + dy * dy * 2 + dz * dz;
      if (d2 < 0.04 && d2 > 1e-8 && o.id !== f.target) {
        const d = Math.sqrt(d2);
        sx -= (dx / d) * (0.2 - d) * 9;
        sz -= (dz / d) * (0.2 - d) * 9;
        ty -= dy * 2;
      }
      if (o.species === f.species && d2 < 0.36) {
        ax += Math.sin(o.yaw); az += Math.cos(o.yaw);
        cx += o.x; cy += o.y; cz += o.z; n++;
      }
    }
    if (n > 0 && f.mood !== "rest" && f.mood !== "guard" && f.mood !== "chase") {
      const k = tr.school * (1 - w.temperament * 0.5);
      sx += (ax / n) * 1.2 * k + (cx / n - f.x) * 2.2 * k;
      sz += (az / n) * 1.2 * k + (cz / n - f.z) * 2.2 * k;
      ty += (cy / n - ty) * 0.6 * k;
    }

    // Territory: a guard circles its spot and goes after a smaller (or other-species) fish that comes in.
    if (aggr && !w.food && (f.mood === "guard" || f.mood === "cruise") && !f.cool) {
      const home = TERRITORY_SPOTS[(f.home ?? 0) % TERRITORY_SPOTS.length]!;
      const hungry = !!st && st.eatCool <= 0 && live.length >= 3;
      let best: SwimFish | null = null, bestD = Infinity, bestHunt = false;
      for (const o of live) {
        if (o === f || (o.grow ?? 1) < 1) continue;
        const ob = fishBody(o.species, w.reef);
        const hunt = hungry && canEat(f, o, w.reef);
        const dHome = Math.hypot(o.x - home[0], o.z - home[2]);
        const d = Math.hypot(o.x - f.x, o.z - f.z);
        const intruder = f.mood === "guard" && dHome < 0.45 && (o.species !== f.species || ob.halfLen < body.halfLen) && ob.halfLen <= body.halfLen * 1.1;
        if ((intruder || (hunt && d < 1.0)) && d < bestD) { best = o; bestD = d; bestHunt = hunt; }
      }
      if (best) {
        f.mood = "chase"; f.target = best.id; f.hunt = bestHunt; f.moodT = bestHunt ? 4 + fishRand(f) * 2 : 1.8 + fishRand(f) * 1.4;
      }
    }

    // Goals.
    if (f.mood === "guard") {
      const home = TERRITORY_SPOTS[(f.home ?? 0) % TERRITORY_SPOTS.length]!;
      const dx = home[0] - f.x, dz = home[2] - f.z;
      const d = Math.hypot(dx, dz) + 1e-4;
      if (d > 0.3) { sx += (dx / d) * 2.2; sz += (dz / d) * 2.2; }
      else { sx += -dz * 3; sz += dx * 3; }
      ty = home[1] + 0.15;
    } else if (f.mood === "chase" && f.target) {
      const o = byId.get(f.target);
      if (!o || o.eaten) { f.moodT = 0; }
      else {
        const lead = 0.25;
        const dx = o.x + Math.sin(o.yaw) * o.speed * lead - f.x, dz = o.z + Math.cos(o.yaw) * o.speed * lead - f.z;
        const d = Math.hypot(dx, dz) + 1e-4;
        sx += (dx / d) * 5; sz += (dz / d) * 5;
        ty = o.y;
        const dist = Math.hypot(o.x - f.x, o.y - f.y, o.z - f.z);
        const ob = fishBody(o.species, w.reef);
        // The chased fish sees it coming: it bolts away from the chaser.
        if (dist < 0.35 && o.mood !== "flee") scare(o, f);
        if (dist < body.halfLen + ob.halfLen + 0.03) {
          if (f.hunt && st && st.eatCool <= 0 && live.length >= 3 && canEat(f, o, w.reef)) {
            eat(o, st);
            f.mood = "rest"; f.moodT = 4 + fishRand(f) * 3; f.cool = 20;
          } else {
            // Nip: the intruder is driven off and the guard goes back to its spot for a while.
            scare(o, f); o.moodT = 1.4 + fishRand(o) * 0.8;
            f.mood = "guard"; f.moodT = 4 + fishRand(f) * 4; f.cool = 5 + fishRand(f) * 4; f.target = undefined;
          }
          f.hunt = false;
        }
        if (!f.hunt && aggrHomeFar(f, o)) { f.moodT = 0; f.cool = 3; }
      }
    } else if (f.mood === "flee" && f.fleeX !== undefined && f.fleeZ !== undefined) {
      const dx = f.x - f.fleeX, dz = f.z - f.fleeZ;
      const d = Math.hypot(dx, dz) + 1e-4;
      sx += (dx / d) * 4.5 - f.x * 0.8; sz += (dz / d) * 4.5 - f.z * 0.8;
    } else if (f.mood === "forage") {
      const p = PLANT_SPOTS[f.plant % PLANT_SPOTS.length]!;
      const dx = p[0] - f.x, dz = p[2] - f.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.18) { sx += (dx / d) * 2.5; sz += (dz / d) * 2.5; }
      else { sx += -dz * 2; sz += dx * 2; } // circle the clump
      ty = p[1] + (fishRand(f) - 0.5) * 0.1;
    } else if (f.mood === "feed" && w.food) {
      const dx = w.food.x - f.x + Math.sin(f.wander) * 0.12, dz = w.food.z - f.z + Math.cos(f.wander) * 0.12;
      const d = Math.hypot(dx, dz) + 1e-4;
      sx += (dx / d) * 4; sz += (dz / d) * 4;
      ty = w.food.y - 0.05;
    } else if (w.cursor && (f.mood === "flee" || f.mood === "inspect")) {
      const dx = w.cursor.x - f.x, dz = w.cursor.z - f.z;
      const d = Math.hypot(dx, dz) + 1e-4;
      const s = f.mood === "flee" ? -4 : d > 0.25 ? 2.5 : 0;
      sx += (dx / d) * s; sz += (dz / d) * s;
      if (f.mood === "inspect") ty = w.cursor.y;
    }

    // Stuck: a fish that has hardly moved for a while (or sits in a corner) is kicked toward open water.
    const tau = Math.min(1, dt / 1.5);
    f.ex = f.ex === undefined ? f.x : f.ex + (f.x - f.ex) * tau;
    f.ez = f.ez === undefined ? f.z : f.ez + (f.z - f.ez) * tau;
    const here = wallPush(f.x, f.z, box, 0.14);
    const parked = Math.hypot(f.x - f.ex, f.z - f.ez) < 0.035 && f.mood !== "rest" && f.mood !== "feed" && f.mood !== "guard";
    f.stuck = (parked || here.near >= 2) ? (f.stuck ?? 0) + dt : Math.max(0, (f.stuck ?? 0) - dt * 2);
    if (f.stuck > 1.2) {
      f.stuck = 0;
      f.goalX = (fishRand(f) - 0.5) * 0.8;
      f.goalZ = -0.2 + (fishRand(f) - 0.5) * 0.6;
      f.mood = "dart"; f.moodT = 0.9; f.target = undefined;
    }
    if (f.goalX !== undefined && f.goalZ !== undefined) {
      const dx = f.goalX - f.x, dz = f.goalZ - f.z;
      const d = Math.hypot(dx, dz) + 1e-4;
      sx += (dx / d) * 6; sz += (dz / d) * 6;
      if (d < 0.25 || f.mood !== "dart") { f.goalX = undefined; f.goalZ = undefined; }
    }

    // Walls: a field that pushes harder the closer the body gets, three look-ahead probes along
    // the nose and both whiskers, and a pull to the middle that wins in corners.
    const reach = WALL_REACH + f.speed * 1.2;
    const wp = wallPush(f.x, f.z, box, reach);
    let wall = 0;
    let wx = wp.px * 3, wz = wp.pz * 3;
    const look = 0.2 + f.speed * 1.4;
    for (const a of [0, 0.55, -0.55]) {
      const px = f.x + Math.sin(f.yaw + a) * look, pz = f.z + Math.cos(f.yaw + a) * look;
      if (!inBox(px, pz, box)) {
        wall = 1;
        const q = wallPush(px, pz, box, reach);
        wx += q.px * 2 + (px < box.xMin ? 2 : px > box.xMax ? -2 : 0);
        wz += q.pz * 2 + (pz < box.zMin ? 2 : pz > box.zMax ? -2 : 0);
      }
    }
    if (wp.near > 0) wall = 1;
    const cxm = (box.xMin + box.xMax) / 2, czm = (box.zMin + box.zMax) / 2;
    const toC = Math.hypot(cxm - f.x, czm - f.z) + 1e-4;
    const centre = wp.near >= 2 ? 4 : wall ? 1.2 : 0.25;
    wx += ((cxm - f.x) / toC) * centre;
    wz += ((czm - f.z) / toC) * centre;
    sx += wx; sz += wz;
    if (wall && Math.abs(sx) + Math.abs(sz) < 1e-3) { sx = cxm - f.x; sz = czm - f.z; }

    // Turn toward the desired heading at a species-limited rate.
    const desired = Math.atan2(sx, sz);
    const maxTurn = tr.turn * moodTurn(f.mood) * (wall ? (wp.near >= 2 ? 2.4 : 1.8) : 1) * (0.85 + f.vigor * 0.3);
    const dyaw = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, wrap(desired - f.yaw)));
    f.yaw = wrap(f.yaw + dyaw);
    f.turnRate = dyaw / dt;

    // Speed eases toward the mood speed; tight turns (and heading into a wall) slow the fish.
    const into = Math.max(0, -(Math.sin(f.yaw) * wp.px + Math.cos(f.yaw) * wp.pz));
    const target = tr.speed * moodSpeed(f.mood) * (0.8 + f.vigor * 0.5) * (1 - Math.min(0.4, Math.abs(f.turnRate) / (tr.turn * 4))) * (1 - Math.min(0.6, into * 0.8)) * motion;
    const ease = f.mood === "dart" || f.mood === "flee" || f.mood === "chase" ? 7 : 1.6;
    f.speed += (target - f.speed) * Math.min(1, ease * dt);
    f.speed = Math.max(0.01 * motion, f.speed);

    const step = f.speed * dt;
    f.x += Math.sin(f.yaw) * step;
    f.z += Math.cos(f.yaw) * step;
    ty = Math.max(bMin, Math.min(bMax, ty));
    if (f.mood === "feed" && w.food) ty = w.food.y - 0.05;
    if (f.mood === "chase" && f.target) ty = byId.get(f.target)?.y ?? ty;
    ty = Math.max(box.yMin, Math.min(box.yMax, ty));
    f.vy += ((ty - f.y) * 1.2 - f.vy) * Math.min(1, 2.5 * dt);
    f.y += f.vy * dt * motion;
    // Hard limit: the whole body stays inside the glass, whatever the steering did.
    f.x = Math.max(box.xMin, Math.min(box.xMax, f.x));
    f.y = Math.max(box.yMin, Math.min(box.yMax, f.y));
    f.z = Math.max(box.zMin, Math.min(box.zMax, f.z));
    f.phase += dt * (2 + (f.speed / Math.max(0.05, tr.speed)) * 3);
  }
}

function aggrHomeFar(f: SwimFish, o: SwimFish): boolean {
  const home = TERRITORY_SPOTS[(f.home ?? 0) % TERRITORY_SPOTS.length]!;
  return Math.hypot(o.x - home[0], o.z - home[2]) > 0.8;
}

function scare(o: SwimFish, from: SwimFish): void {
  if (o.mood === "chase") o.target = undefined;
  o.mood = "flee"; o.fleeX = from.x; o.fleeZ = from.z;
  o.moodT = Math.max(o.moodT, 0.9 + fishRand(o) * 0.6);
}

function eat(prey: SwimFish, st: SchoolState): void {
  st.puffs.push({ x: prey.x, y: prey.y, z: prey.z, age: 0 });
  st.eats++;
  st.eatCool = EAT_MIN_INTERVAL + fishRand(prey) * EAT_JITTER;
  prey.eaten = true;
  prey.respawnT = RESPAWN_MIN + fishRand(prey) * 20;
  prey.target = undefined; prey.fleeX = undefined; prey.fleeZ = undefined;
}

/** An eaten fish comes back as a small fry out of a plant clump and grows to full size. */
function hatch(f: SwimFish, reef: boolean): void {
  const p = PLANT_SPOTS[Math.floor(fishRand(f) * PLANT_SPOTS.length)]!;
  const box = swimBox(f.species, reef, 1);
  f.eaten = false; f.respawnT = undefined; f.grow = 0.2;
  f.x = Math.max(box.xMin, Math.min(box.xMax, p[0]));
  f.z = Math.max(box.zMin, Math.min(box.zMax, p[2] + 0.1));
  f.y = Math.max(box.yMin, Math.min(box.yMax, p[1] + 0.1));
  f.yaw = Math.atan2(-f.x, -f.z + 0.2);
  f.speed = 0.05; f.vy = 0; f.mood = "cruise"; f.moodT = 2; f.ex = f.x; f.ez = f.z; f.stuck = 0;
}
