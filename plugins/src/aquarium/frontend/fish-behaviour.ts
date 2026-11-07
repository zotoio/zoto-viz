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
  /** Behaviour profile (see SPECIES_PROFILES); filled from the profile table. */
  profile?: FishProfile;
  /** Base tail-beat frequency at cruise, Hz-ish (phase rad / s / 2pi scaled). */
  beat?: number;
  /** Burst-and-glide timing: burst min, burst spread, glide min, glide spread (s). Glide min 0 = never glides. */
  glide?: readonly [number, number, number, number];
}

export type FishProfile = "school" | "territorial" | "hover" | "bottom" | "anchor" | "roam";

/** Data-driven per-species behaviour profiles, in the same order as the trait tables. */
export const SPECIES_PROFILES: {
  fresh: readonly { name: string; profile: FishProfile; beat: number; glide: readonly [number, number, number, number] }[];
  reef: readonly { name: string; profile: FishProfile; beat: number; glide: readonly [number, number, number, number] }[];
} = {
  fresh: [
    { name: "neon", profile: "school", beat: 7.5, glide: [0.5, 0.6, 0.25, 0.35] },
    { name: "angel", profile: "hover", beat: 2.2, glide: [0.6, 0.6, 1.4, 1.6] },
    { name: "guppy", profile: "roam", beat: 6.5, glide: [0.5, 0.8, 0.3, 0.5] },
    { name: "cory", profile: "bottom", beat: 5.5, glide: [0.4, 0.5, 0.6, 1.0] },
    { name: "discus", profile: "hover", beat: 2.0, glide: [0.8, 0.8, 1.2, 1.4] },
    { name: "cichlid", profile: "territorial", beat: 4.0, glide: [0.6, 0.8, 0.5, 0.7] },
    { name: "betta", profile: "territorial", beat: 2.6, glide: [0.6, 0.6, 1.0, 1.2] },
  ],
  reef: [
    { name: "clown", profile: "anchor", beat: 6.0, glide: [0.5, 0.5, 0.2, 0.3] },
    { name: "tang", profile: "roam", beat: 3.2, glide: [1.0, 1.0, 0.6, 0.8] },
    { name: "damsel", profile: "territorial", beat: 6.5, glide: [0.4, 0.5, 0.3, 0.4] },
    { name: "goby", profile: "bottom", beat: 4.5, glide: [0.3, 0.3, 1.0, 1.6] },
    { name: "yellowtang", profile: "roam", beat: 3.4, glide: [1.0, 1.0, 0.6, 0.8] },
    { name: "gramma", profile: "hover", beat: 3.0, glide: [0.5, 0.5, 1.0, 1.2] },
  ],
};

/** Where clownfish keep house (the reef anemone, glTF x / z). */
export const ANEMONE_SPOT: readonly [number, number] = [0.35, 0.25];

/** Freshwater: neon, angel, guppy, cory, discus, cichlid, betta. */
export const FRESH_TRAITS: FishTraits[] = [
  { speed: 0.34, turn: 3.2, school: 1.0, yMin: 0.0, yMax: 0.45, dart: 0.06, rest: 0.01, plant: 0.03, curious: -0.8, jitter: 1.1, aggro: 0 },
  { speed: 0.16, turn: 1.3, school: 0.35, yMin: 0.15, yMax: 0.6, dart: 0.01, rest: 0.05, plant: 0.08, curious: 0.6, jitter: 0.5, aggro: 0.45 },
  { speed: 0.3, turn: 2.8, school: 0.6, yMin: 0.2, yMax: 0.7, dart: 0.08, rest: 0.02, plant: 0.04, curious: 0.3, jitter: 1.3, aggro: 0 },
  { speed: 0.15, turn: 2.0, school: 0.45, yMin: -0.5, yMax: -0.38, dart: 0.03, rest: 0.05, plant: 0.1, curious: -0.2, jitter: 0.9, aggro: 0 },
  { speed: 0.14, turn: 1.1, school: 0.45, yMin: 0.05, yMax: 0.45, dart: 0.01, rest: 0.05, plant: 0.06, curious: 0.4, jitter: 0.4, aggro: 0.25 },
  { speed: 0.24, turn: 2.2, school: 0.1, yMin: -0.35, yMax: 0.25, dart: 0.07, rest: 0.03, plant: 0.06, curious: 0.8, jitter: 0.8, aggro: 0.85 },
  { speed: 0.13, turn: 1.5, school: 0.0, yMin: 0.35, yMax: 0.72, dart: 0.02, rest: 0.07, plant: 0.07, curious: 0.7, jitter: 0.6, aggro: 0.6 },
];

/** Reef: clown, blue tang, damsel, goby, yellow tang, royal gramma. */
export const REEF_TRAITS: FishTraits[] = [
  { speed: 0.18, turn: 2.4, school: 0.3, yMin: -0.25, yMax: 0.2, dart: 0.03, rest: 0.05, plant: 0.14, curious: 0.5, jitter: 1.0, aggro: 0.2 },
  { speed: 0.3, turn: 1.6, school: 0.7, yMin: 0.1, yMax: 0.65, dart: 0.02, rest: 0.01, plant: 0.03, curious: 0.2, jitter: 0.5, aggro: 0.3 },
  { speed: 0.3, turn: 3.0, school: 0.9, yMin: 0.0, yMax: 0.5, dart: 0.07, rest: 0.01, plant: 0.04, curious: -0.7, jitter: 1.2, aggro: 0.8 },
  { speed: 0.1, turn: 2.2, school: 0.0, yMin: -0.5, yMax: -0.4, dart: 0.06, rest: 0.1, plant: 0.06, curious: -0.4, jitter: 0.9, aggro: 0.1 },
  { speed: 0.28, turn: 1.7, school: 0.5, yMin: 0.05, yMax: 0.6, dart: 0.02, rest: 0.01, plant: 0.03, curious: 0.3, jitter: 0.6, aggro: 0.2 },
  { speed: 0.08, turn: 0.9, school: 0.0, yMin: -0.45, yMax: -0.2, dart: 0.0, rest: 0.15, plant: 0.12, curious: 0.0, jitter: 0.3, aggro: 0 },
];

function applyProfiles(t: FishTraits[], p: (typeof SPECIES_PROFILES)["fresh"]): void {
  t.forEach((tr, i) => {
    const q = p[i];
    if (q) { tr.profile = q.profile; tr.beat = q.beat; tr.glide = q.glide; }
    if (tr.profile === "territorial") tr.aggro = Math.max(tr.aggro, 0.9);
  });
}
applyProfiles(FRESH_TRAITS, SPECIES_PROFILES.fresh);
applyProfiles(REEF_TRAITS, SPECIES_PROFILES.reef);

export function traitsFor(species: number, reef: boolean): FishTraits {
  const t = reef ? REEF_TRAITS : FRESH_TRAITS;
  return t[Math.max(0, Math.min(t.length - 1, Math.round(species)))] ?? t[0]!;
}

/**
 * Tank swim volume: the inside of the glass (x ±1.22, back pane z -1.02, lid y 0.82) above the
 * gravel (top ≈ -0.74). Front stops short of the open front so fish never swim into the lens.
 * These are the limits for the whole body; {@link swimBox} shrinks them by the fish's own size.
 */
/** The tank volume. x follows the pane (see tank-geometry.ts / setTankHalfWidth); y and z are fixed. */
export const TANK = { xMin: -1.2, xMax: 1.2, yMin: -0.72, yMax: 0.78, zMin: -1.0, zMax: 0.62 };

/** Resize the tank's length (the pane got wider or narrower); fish ease in on the wall field. */
export function setTankHalfWidth(halfW: number): void {
  TANK.xMin = -halfW;
  TANK.xMax = halfW;
}

/** Scale the Blender fish templates were built at (blender/build_scape.py builds them at full size). */
export const FISH_MESH_SCALE = 2.0;
/** Clear water kept between a fish's body and the glass. */
export const WALL_GAP = 0.03;

/** Fish template half-extents (before {@link FISH_MESH_SCALE}): nose-to-tail half length, half height (fins included). */
const MESH_BODY: Record<string, [number, number]> = {
  neon: [0.018, 0.008], angel: [0.06, 0.076], guppy: [0.02, 0.015], cory: [0.032, 0.023],
  discus: [0.075, 0.06], cichlid: [0.053, 0.025], betta: [0.037, 0.031], clown: [0.04, 0.022],
  tang: [0.06, 0.045], damsel: [0.022, 0.014], goby: [0.03, 0.01], yellowtang: [0.05, 0.04], gramma: [0.025, 0.012],
};
const FRESH_MESH = ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta"];
/** Reef species, in sim order (see tank-types.ts). */
const REEF_MESH = ["clown", "tang", "damsel", "goby", "yellowtang", "gramma"];

/** Template name (fish-<name> in assets/aquarium-scape.glb) for a species. */
export function fishTemplate(species: number, reef: boolean): string {
  const names = reef ? REEF_MESH : FRESH_MESH;
  return names[Math.max(0, Math.min(names.length - 1, Math.round(species)))] ?? "neon";
}

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
export function bandY(v: number): number {
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
  /** Test-only override (seconds) for the gap between eats; 0 = off, the normal rare rate. */
  testInterval?: number;
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
  /** Burst-and-glide: coasting now, and seconds left in this burst / glide. */
  gliding?: boolean;
  glideT?: number;
  /** Fading out of the tank (talker gone / tank shrank): no regrowth. */
  fade?: boolean;
  /** Exploration: own coverage map (visits per cell, decaying), current target and its timer. */
  cov?: Float32Array;
  tx?: number;
  tz?: number;
  tT?: number;
  /** Seconds left in an excursion out of the preferred depth band, and its depth. */
  excT?: number;
  excY?: number;
  /** Bottom dwellers: seconds left in a surface dash. */
  surfT?: number;
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
    // A hunt that is under way carries on through feeding (traffic feeds almost constantly on a busy network).
    if (f.mood === "chase" && f.hunt && f.moodT > 0) return;
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
  if (r2 < tr.dart * hot * win) { f.mood = "dart"; f.moodT = 0.35 + fishRand(f) * 0.4; f.wander = wrap(f.wander + (fishRand(f) - 0.5) * 1.6); } // steer into the dart, never snap the heading
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
const STEP_BY_ID = new Map<string, SwimFish>();
const STEP_LIVE: SwimFish[] = [];

/** Scape module width; the host repeats the decor every module, mirrored every other one. */
export const SCAPE_MODULE_W = 2.44;
/** The x of the copy of a base-module decor point nearest to `near` that is inside the tank. */
export function nearestTileX(x0: number, near: number): number {
  let best = x0, bd = Math.abs(x0 - near);
  for (let k = -2; k <= 2; k++) {
    if (!k) continue;
    const x = (k % 2 ? -x0 : x0) + k * SCAPE_MODULE_W;
    if (x < TANK.xMin + 0.15 || x > TANK.xMax - 0.15) continue;
    const d = Math.abs(x - near);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}

/** Scratch for {@link homeSpot} (no per-step allocation). */
const HOME: [number, number, number] = [0, 0, 0];
/**
 * A territorial fish's home: the territory spots, spread across the tank's current length so on
 * a long (ultrawide) tank the guards hold zones from end to end instead of all in the middle.
 */
export function homeSpot(f: SwimFish): readonly [number, number, number] {
  const n = TERRITORY_SPOTS.length;
  const i = (f.home ?? 0) % n;
  const sp = TERRITORY_SPOTS[i]!;
  const span = Math.max(0.2, TANK.xMax - TANK.xMin - 0.6);
  // even slots along x by index, with the authored spot's offset kept as a little jitter
  HOME[0] = TANK.xMin + 0.3 + span * ((i + 0.5) / n) + sp[0] * 0.08;
  HOME[1] = sp[1];
  HOME[2] = sp[2];
  return HOME;
}

/** Exploration grid: cells across x (~0.3 wide, grows with the tank) and 4 front-to-back. */
export const EXPLORE_NZ = 4;
export function exploreNx(): number {
  return Math.max(4, Math.round((TANK.xMax - TANK.xMin - 2 * EXPLORE_INSET) / 0.3));
}
/** The grid spans the swimmable water: the tank less a body's reach from the glass. */
const EXPLORE_INSET = 0.12;
export function exploreCell(x: number, z: number, nx: number): number {
  const u = (x - TANK.xMin - EXPLORE_INSET) / Math.max(1e-6, TANK.xMax - TANK.xMin - 2 * EXPLORE_INSET);
  const v = (z - TANK.zMin - EXPLORE_INSET) / Math.max(1e-6, TANK.zMax - TANK.zMin - 2 * EXPLORE_INSET);
  const ix = Math.max(0, Math.min(nx - 1, Math.floor(u * nx)));
  const iz = Math.max(0, Math.min(EXPLORE_NZ - 1, Math.floor(v * EXPLORE_NZ)));
  return iz * nx + ix;
}

/**
 * Novelty-seeking wander target for a fish (solitary) or a school leader: the least-visited cell
 * of its own coverage map (visits decay, so old ground becomes interesting again), ties broken by
 * the fish's own RNG. Followers in a school use the leader's target, so the school moves as one.
 */
function pickExploreTarget(f: SwimFish, cruise: number): void {
  const nx = exploreNx();
  const cov = f.cov!;
  let best = -1, bestV = Infinity;
  const r0 = Math.floor(fishRand(f) * cov.length);
  for (let k = 0; k < cov.length; k++) {
    const c = (r0 + k) % cov.length;
    // prefer far cells a little so a fish crosses the tank rather than dithering next door
    const cx = TANK.xMin + EXPLORE_INSET + ((c % nx) + 0.5) / nx * (TANK.xMax - TANK.xMin - 2 * EXPLORE_INSET);
    const cz = TANK.zMin + EXPLORE_INSET + (Math.floor(c / nx) + 0.5) / EXPLORE_NZ * (TANK.zMax - TANK.zMin - 2 * EXPLORE_INSET);
    const v = cov[c]! - Math.min(0.6, Math.hypot(cx - f.x, cz - f.z) * 0.25);
    if (v < bestV) { bestV = v; best = c; }
  }
  const ix = best % nx, iz = Math.floor(best / nx);
  const tx = TANK.xMin + EXPLORE_INSET + (ix + 0.2 + fishRand(f) * 0.6) / nx * (TANK.xMax - TANK.xMin - 2 * EXPLORE_INSET);
  const tz = TANK.zMin + EXPLORE_INSET + (iz + 0.2 + fishRand(f) * 0.6) / EXPLORE_NZ * (TANK.zMax - TANK.zMin - 2 * EXPLORE_INSET);
  f.tx = tx;
  f.tz = tz;
  // long enough to get there at cruise speed (a slow cory crossing an ultrawide tank needs a while)
  f.tT = 5 + fishRand(f) * 5 + (Math.hypot(tx - f.x, tz - f.z) / Math.max(0.05, cruise)) * 1.4;
}

/** Visit the fish's cell on its own map and keep its target fresh. */
function exploreStep(f: SwimFish, dt: number, cruise: number): void {
  const nx = exploreNx();
  const n = nx * EXPLORE_NZ;
  if (!f.cov || f.cov.length !== n) { f.cov = new Float32Array(n); f.tT = 0; }
  const cov = f.cov;
  const decay = Math.exp(-dt / 400);
  for (let i = 0; i < n; i++) cov[i]! *= decay;
  cov[exploreCell(f.x, f.z, nx)]! += dt;
  f.tT = (f.tT ?? 0) - dt;
  if (f.tx === undefined || f.tz === undefined || f.tT <= 0 || Math.hypot(f.tx - f.x, f.tz - f.z) < 0.22) pickExploreTarget(f, cruise);
}

export function stepSchool(school: SwimFish[], w: SwimWorld, dt: number): void {
  const motion = Math.max(0.05, Math.min(1, w.motion));
  const st = w.state;
  if (st) {
    st.t += dt;
    st.eatCool = Math.max(0, st.eatCool - dt);
    let keep = 0;
    for (const p of st.puffs) {
      p.age += dt; p.y += 0.02 * dt;
      if (p.age < PUFF_LIFE) st.puffs[keep++] = p;
    }
    st.puffs.length = keep;
  }
  // reused scratch: no per-step Map / array allocations
  const byId = STEP_BY_ID;
  byId.clear();
  const live = STEP_LIVE;
  live.length = 0;
  for (const f of school) {
    byId.set(f.id, f);
    if (!f.eaten) live.push(f);
  }
  for (const f of school) {
    if (f.eaten) {
      f.respawnT = (f.respawnT ?? RESPAWN_MIN) - dt;
      if (f.respawnT <= 0) hatch(f, w.reef);
      continue;
    }
    if (f.grow !== undefined && f.grow < 1 && !f.fade) f.grow = Math.min(1, f.grow + dt / HATCH_GROW);
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
      // personal space grows with both bodies, so big fish do not swim through each other
      const space = Math.max(0.2, body.halfLen + fishBody(o.species, w.reef).halfLen + 0.08);
      if (d2 < space * space && d2 > 1e-8 && o.id !== f.target) {
        const d = Math.sqrt(d2);
        sx -= (dx / d) * (space - d) * (9 * 0.2 / space);
        sz -= (dz / d) * (space - d) * (9 * 0.2 / space);
        ty -= dy * 2;
      }
      if (o.species === f.species && d2 < 0.36) {
        ax += Math.sin(o.yaw); az += Math.cos(o.yaw);
        cx += o.x; cy += o.y; cz += o.z; n++;
      }
    }
    if (n > 0 && f.mood !== "rest" && f.mood !== "guard" && f.mood !== "chase") {
      const k = tr.school * (1 - w.temperament * 0.5) * (tr.profile === "school" ? 1.7 : 1);
      sx += (ax / n) * 1.2 * k + (cx / n - f.x) * 2.2 * k;
      sz += (az / n) * 1.2 * k + (cz / n - f.z) * 2.2 * k;
      ty += (cy / n - ty) * 0.6 * k;
    }

    // Territory: a guard circles its spot and goes after a smaller (or other-species) fish that comes in.
    const hungryNow = !!st && st.eatCool <= 0 && live.length >= 3;
    if (aggr && (!w.food || hungryNow) && (f.mood === "guard" || f.mood === "cruise" || f.mood === "feed") && !f.cool) {
      const home = homeSpot(f);
      const hungry = hungryNow;
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
      const home = homeSpot(f);
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
    } else if (f.mood === "forage" && tr.profile !== "bottom") {
      // (bottom dwellers forage the open substrate along their exploration path instead)
      const p = PLANT_SPOTS[f.plant % PLANT_SPOTS.length]!;
      // a long tank repeats the scape (mirrored every other module): visit the nearest copy
      const px = nearestTileX(p[0], f.x);
      const dx = px - f.x, dz = p[2] - f.z;
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

    // Species profile: where this kind of fish wants to be when nothing else is going on.
    const calm = f.mood === "cruise" || f.mood === "rest" || f.mood === "forage";
    if (calm) {
      if (tr.profile === "territorial") {
        // patrol a loop around its own spot
        const home = homeSpot(f);
        const dx = home[0] - f.x, dz = home[2] - f.z;
        const d = Math.hypot(dx, dz) + 1e-4;
        const r = 0.28;
        sx += (dx / d) * (d - r) * 4 + (-dz / d) * 0.9;
        sz += (dz / d) * (d - r) * 4 + (dx / d) * 0.9;
      } else if (tr.profile === "anchor") {
        const dx = ANEMONE_SPOT[0] - f.x, dz = ANEMONE_SPOT[1] - f.z;
        const d = Math.hypot(dx, dz) + 1e-4;
        if (d > 0.16) { sx += (dx / d) * 3 * Math.min(2, d / 0.16); sz += (dz / d) * 3 * Math.min(2, d / 0.16); }
        else { sx += -dz * 4; sz += dx * 4; }
        ty = bMin + 0.04 + Math.sin(f.phase * 0.03) * 0.03;
      } else if (tr.profile === "hover") {
        // slow, upright station-keeping with a gentle vertical bob
        ty = (bMin + bMax) / 2 + Math.sin(f.phase * 0.02 + f.wander) * (bMax - bMin) * 0.3;
      } else if (tr.profile === "bottom") {
        // forage along the substrate; now and then a dash to the surface for a gulp of air
        f.surfT = Math.max(0, (f.surfT ?? 0) - dt);
        if (f.surfT === 0 && fishRand(f) < 0.012 * dt) f.surfT = 3.2;
        ty = f.surfT > 1.4 ? box.yMax : bMin;
      }
    }

    // Explore: within its depth band a fish (or its school, led by the first of its kind in the
    // school) heads for under-visited parts of the tank, end to end and front to back.
    if (calm && tr.profile !== "anchor" && !(tr.profile === "territorial" && aggr)) {
      let lead: SwimFish = f;
      if (tr.profile === "school" || tr.school >= 0.2) {
        for (const o of live) if (o.species === f.species && !o.fade) { lead = o; break; }
      }
      if (lead === f) exploreStep(f, dt, tr.speed);
      if (lead.tx !== undefined && lead.tz !== undefined) {
        const dx = lead.tx - f.x, dz = lead.tz - f.z;
        const d = Math.hypot(dx, dz) + 1e-4;
        const k = lead === f ? 1.6 : 1.1;
        sx += (dx / d) * k * Math.min(1, d / 0.3 + 0.3);
        sz += (dz / d) * k * Math.min(1, d / 0.3 + 0.3);
      }
    }
    // Depth: the band is soft (the wander bob above), and now and then a fish makes a short
    // excursion out of it before drifting home.
    f.excT = Math.max(0, (f.excT ?? 0) - dt);
    if (calm && f.excT === 0 && tr.profile !== "bottom" && tr.profile !== "anchor" && fishRand(f) < 0.02 * dt) {
      f.excT = 3 + fishRand(f) * 3;
      f.excY = box.yMin + fishRand(f) * (box.yMax - box.yMin);
    }
    if (f.excT > 0 && f.excY !== undefined && tr.profile !== "anchor") ty = f.excY;

    // Stuck: a fish that has hardly moved for a while (or sits in a corner) is kicked toward open water.
    const tau = Math.min(1, dt / 1.5);
    f.ex = f.ex === undefined ? f.x : f.ex + (f.x - f.ex) * tau;
    f.ez = f.ez === undefined ? f.z : f.ez + (f.z - f.ez) * tau;
    const here = wallPush(f.x, f.z, box, 0.14);
    const parked = Math.hypot(f.x - f.ex, f.z - f.ez) < 0.035 && f.mood !== "rest" && f.mood !== "feed" && f.mood !== "guard";
    f.stuck = (parked || here.near >= 2) ? (f.stuck ?? 0) + dt : Math.max(0, (f.stuck ?? 0) - dt * 2);
    if (f.stuck > 1.2) {
      f.stuck = 0;
      // out toward open water: its exploration target when it has one, else anywhere end to end
      f.goalX = f.tx ?? TANK.xMin + 0.4 + fishRand(f) * Math.max(0.1, TANK.xMax - TANK.xMin - 0.8);
      f.goalZ = f.tz ?? -0.2 + (fishRand(f) - 0.5) * 0.6;
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
    // calm fish cruise close along the glass (real fish use the whole tank); fast ones keep more room
    const reach = (calm ? WALL_REACH * 0.5 : WALL_REACH) + f.speed * (calm ? 0.7 : 1.2);
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
    // no standing pull to the middle (it made fish cluster there); only out of walls and corners
    const centre = wp.near >= 2 ? 4 : wall ? 1.2 : 0;
    wx += ((cxm - f.x) / toC) * centre;
    wz += ((czm - f.z) / toC) * centre;
    sx += wx; sz += wz;
    if (wall && Math.abs(sx) + Math.abs(sz) < 1e-3) { sx = cxm - f.x; sz = czm - f.z; }

    // Turn toward the desired heading at a species-limited rate.
    const desired = Math.atan2(sx, sz);
    const maxTurn = tr.turn * moodTurn(f.mood) * (wall ? (wp.near >= 2 ? 2.4 : 1.8) : 1) * (0.85 + f.vigor * 0.3);
    // The yaw rate itself eases (limited angular acceleration), so a heading never flips or twitches;
    // it slows into the desired heading instead of overshooting.
    const err = wrap(desired - f.yaw);
    const wantRate = Math.max(-maxTurn, Math.min(maxTurn, err * 2.6));
    const angAcc = maxTurn * (wall ? 8 : 4);
    const rate = f.turnRate + Math.max(-angAcc * dt, Math.min(angAcc * dt, wantRate - f.turnRate));
    // the rate eases down too when the limit drops (mood / wall change), inside the species ceiling
    const ceiling = tr.turn * 2.2 * 2.4 * (0.85 + f.vigor * 0.3);
    const dyaw = Math.max(-ceiling * dt, Math.min(ceiling * dt, rate * dt));
    f.yaw = wrap(f.yaw + dyaw);
    f.turnRate = dyaw / dt;

    // Speed eases toward the mood speed; tight turns (and heading into a wall) slow the fish.
    const into = Math.max(0, -(Math.sin(f.yaw) * wp.px + Math.cos(f.yaw) * wp.pz));
    const target = tr.speed * moodSpeed(f.mood) * (0.8 + f.vigor * 0.5) * (1 - Math.min(0.4, Math.abs(f.turnRate) / (tr.turn * 4))) * (1 - Math.min(0.6, into * 0.8)) * motion;
    // Burst-and-glide: a few tail beats of thrust, then a coast that slows on drag alone.
    const fast = f.mood === "dart" || f.mood === "flee" || f.mood === "chase";
    f.glideT = (f.glideT ?? fishRand(f) * 2) - dt;
    if (f.glideT <= 0) {
      f.gliding = !f.gliding && !fast;
      const g = tr.glide ?? [0.7, 1.1, 0.5, 0.9];
      if (g[2] <= 0) f.gliding = false;
      f.glideT = f.gliding ? g[2] + fishRand(f) * g[3] : g[0] + fishRand(f) * g[1];
    }
    if (fast || (f.surfT ?? 0) > 0) f.gliding = false;
    if (f.gliding) {
      f.speed *= Math.exp(-0.9 * dt);
    } else {
      const ease = fast ? 7 : 1.8;
      // limited acceleration: a dart is a quick push, not a teleport
      const maxAcc = (fast ? 1.0 : 0.35) * dt;
      f.speed += Math.max(-maxAcc, Math.min(maxAcc, (target * 1.12 - f.speed) * Math.min(1, ease * dt)));
    }
    f.speed = Math.max(0.01 * motion, f.speed);

    // Move along the nose, but stop at the body box rather than being pushed back out of it.
    let step = f.speed * dt;
    const ux = Math.sin(f.yaw), uz = Math.cos(f.yaw);
    if (inBox(f.x, f.z, box)) {
      if (ux > 1e-9) step = Math.min(step, (box.xMax - f.x) / ux);
      else if (ux < -1e-9) step = Math.min(step, (box.xMin - f.x) / ux);
      if (uz > 1e-9) step = Math.min(step, (box.zMax - f.z) / uz);
      else if (uz < -1e-9) step = Math.min(step, (box.zMin - f.z) / uz);
      step = Math.max(0, step);
    }
    f.x += ux * step;
    f.z += uz * step;
    if (!((f.excT ?? 0) > 0) && !((f.surfT ?? 0) > 1.4)) ty = Math.max(bMin, Math.min(bMax, ty));
    if (f.mood === "feed" && w.food) ty = w.food.y - 0.05;
    if (f.mood === "chase" && f.target) ty = byId.get(f.target)?.y ?? ty;
    ty = Math.max(box.yMin, Math.min(box.yMax, ty));
    f.vy += ((ty - f.y) * 1.2 - f.vy) * Math.min(1, 2.5 * dt);
    f.y += f.vy * dt * motion;
    // Hard limit: the whole body stays inside the glass, whatever the steering did.
    f.x = Math.max(box.xMin, Math.min(box.xMax, f.x));
    f.y = Math.max(box.yMin, Math.min(box.yMax, f.y));
    f.z = Math.max(box.zMin, Math.min(box.zMax, f.z));
    // Tail-beat phase: frequency follows thrust (speed), and nearly stops while gliding.
    const base = tr.beat ?? 4;
    const beat = f.gliding ? base * 0.12 : base * (0.55 + 0.75 * Math.min(2, f.speed / Math.max(0.05, tr.speed)));
    f.phase += dt * beat;
  }
}

function aggrHomeFar(f: SwimFish, o: SwimFish): boolean {
  const home = homeSpot(f);
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
  st.eatCool = st.testInterval && st.testInterval > 0
    ? st.testInterval
    : EAT_MIN_INTERVAL + fishRand(prey) * EAT_JITTER;
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
