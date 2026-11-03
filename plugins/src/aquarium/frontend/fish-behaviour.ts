/**
 * Rule-based fish behaviour for the aquarium. Each fish is a small steering agent:
 * wander + school (separation / alignment / cohesion with its own species) + wall look-ahead
 * + plant visits + food + cursor, with rest and dart moods. Fish only ever move along their
 * nose (yaw) so they never slide sideways or tail-first; the yaw change per step is the real
 * turn rate the host uses to bend the HD spine.
 */

export type FishMood = "cruise" | "rest" | "dart" | "forage" | "feed" | "flee" | "inspect";

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
}

/** Freshwater: neon, angel, guppy, cory, discus, cichlid, betta. */
export const FRESH_TRAITS: FishTraits[] = [
  { speed: 0.34, turn: 3.2, school: 1.0, yMin: 0.0, yMax: 0.45, dart: 0.06, rest: 0.01, plant: 0.03, curious: -0.8, jitter: 1.1 },
  { speed: 0.16, turn: 1.3, school: 0.35, yMin: 0.15, yMax: 0.6, dart: 0.01, rest: 0.05, plant: 0.08, curious: 0.6, jitter: 0.5 },
  { speed: 0.3, turn: 2.8, school: 0.6, yMin: 0.2, yMax: 0.7, dart: 0.08, rest: 0.02, plant: 0.04, curious: 0.3, jitter: 1.3 },
  { speed: 0.12, turn: 2.0, school: 0.55, yMin: -0.5, yMax: -0.38, dart: 0.03, rest: 0.08, plant: 0.1, curious: -0.2, jitter: 0.9 },
  { speed: 0.14, turn: 1.1, school: 0.45, yMin: 0.05, yMax: 0.45, dart: 0.01, rest: 0.05, plant: 0.06, curious: 0.4, jitter: 0.4 },
  { speed: 0.24, turn: 2.2, school: 0.1, yMin: -0.35, yMax: 0.25, dart: 0.07, rest: 0.03, plant: 0.06, curious: 0.8, jitter: 0.8 },
  { speed: 0.13, turn: 1.5, school: 0.0, yMin: 0.35, yMax: 0.72, dart: 0.02, rest: 0.07, plant: 0.07, curious: 0.7, jitter: 0.6 },
];

/** Reef: clown, tang, damsel, goby, wrasse, anemone. */
export const REEF_TRAITS: FishTraits[] = [
  { speed: 0.18, turn: 2.4, school: 0.3, yMin: -0.25, yMax: 0.2, dart: 0.03, rest: 0.05, plant: 0.14, curious: 0.5, jitter: 1.0 },
  { speed: 0.3, turn: 1.6, school: 0.7, yMin: 0.1, yMax: 0.65, dart: 0.02, rest: 0.01, plant: 0.03, curious: 0.2, jitter: 0.5 },
  { speed: 0.3, turn: 3.0, school: 0.9, yMin: 0.0, yMax: 0.5, dart: 0.07, rest: 0.01, plant: 0.04, curious: -0.7, jitter: 1.2 },
  { speed: 0.1, turn: 2.2, school: 0.0, yMin: -0.5, yMax: -0.4, dart: 0.06, rest: 0.1, plant: 0.06, curious: -0.4, jitter: 0.9 },
  { speed: 0.34, turn: 2.6, school: 0.4, yMin: -0.1, yMax: 0.5, dart: 0.05, rest: 0.01, plant: 0.03, curious: 0.4, jitter: 1.0 },
  { speed: 0.08, turn: 0.9, school: 0.0, yMin: -0.45, yMax: -0.2, dart: 0.0, rest: 0.15, plant: 0.12, curious: 0.0, jitter: 0.3 },
];

export function traitsFor(species: number, reef: boolean): FishTraits {
  const t = reef ? REEF_TRAITS : FRESH_TRAITS;
  return t[Math.max(0, Math.min(t.length - 1, Math.round(species)))] ?? t[0]!;
}

/** Tank swim volume (inside the glass, above the gravel). */
export const TANK = { xMin: -1.0, xMax: 1.0, yMin: -0.5, yMax: 0.72, zMin: -0.95, zMax: 0.95 } as const;

/** Plant clumps fish visit (x, y, z); matches the planted bed along the back and sides. */
export const PLANT_SPOTS: readonly [number, number, number][] = [
  [-0.75, -0.25, -0.6], [-0.2, -0.2, -0.7], [0.45, -0.25, -0.65], [0.8, -0.3, 0.1], [-0.8, -0.3, 0.3],
];

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
}

export interface SwimWorld {
  reef: boolean;
  temperament: number;
  food: { x: number; y: number; z: number } | null;
  cursor: { x: number; y: number; z: number } | null;
  /** 0..1 global motion scale (reduced motion). */
  motion: number;
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
    case "feed": return 1.5;
    case "forage": return 0.7;
    case "inspect": return 0.55;
    default: return 1;
  }
}

function moodTurn(m: FishMood): number {
  return m === "dart" || m === "flee" ? 2.2 : m === "rest" ? 0.5 : m === "feed" ? 1.5 : 1;
}

function pickMood(f: SwimFish, tr: FishTraits, w: SwimWorld, dt: number): void {
  f.moodT -= dt;
  if (w.food) {
    if (f.mood !== "feed") { f.mood = "feed"; f.moodT = 2 + fishRand(f) * 2; }
    return;
  }
  if (f.mood === "feed") { f.mood = "cruise"; f.moodT = 2; }
  if (w.cursor) {
    const d = Math.hypot(w.cursor.x - f.x, w.cursor.y - f.y, w.cursor.z - f.z);
    if (d < 0.55 && tr.curious < -0.1 && f.mood !== "flee") { f.mood = "flee"; f.moodT = 0.8 + fishRand(f) * 0.6; return; }
    if (d < 1.1 && tr.curious > 0.2 && f.mood === "cruise" && fishRand(f) < tr.curious * dt * 2) { f.mood = "inspect"; f.moodT = 2 + fishRand(f) * 2; return; }
  }
  if (f.moodT > 0) return;
  const r = fishRand(f);
  const hot = 0.6 + w.temperament + f.vigor * 0.8;
  // Moods are rolled once a second-ish: scale chances by the roll window.
  const win = 1.2;
  if (r < tr.dart * hot * win) { f.mood = "dart"; f.moodT = 0.35 + fishRand(f) * 0.4; f.yaw += (fishRand(f) - 0.5) * 1.6; }
  else if (r < (tr.dart * hot + tr.rest * (1.4 - w.temperament)) * win) { f.mood = "rest"; f.moodT = 2.5 + fishRand(f) * 4; }
  else if (r < (tr.dart * hot + tr.rest + tr.plant) * win) {
    f.mood = "forage"; f.moodT = 3 + fishRand(f) * 4; f.plant = Math.floor(fishRand(f) * PLANT_SPOTS.length);
  } else { f.mood = "cruise"; f.moodT = 1 + fishRand(f) * 1.5; }
}

/** One fixed step for the whole school. Mutates fish in place. */
export function stepSchool(school: SwimFish[], w: SwimWorld, dt: number): void {
  const motion = Math.max(0.05, Math.min(1, w.motion));
  for (const f of school) {
    const tr = traitsFor(f.species, w.reef);
    pickMood(f, tr, w, dt);
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    // Wander: a slowly drifting heading offset ahead of the nose.
    f.wander = wrap(f.wander + (fishRand(f) - 0.5) * tr.jitter * 6 * dt);
    let sx = fx + Math.sin(f.yaw + f.wander) * 0.6;
    let sz = fz + Math.cos(f.yaw + f.wander) * 0.6;
    let ty = (tr.yMin + tr.yMax) / 2 + Math.sin(f.wander * 2 + f.phase * 0.05) * (tr.yMax - tr.yMin) * 0.45;

    // School with same species; keep personal space from everyone.
    let ax = 0, az = 0, cx = 0, cy = 0, cz = 0, n = 0;
    for (const o of school) {
      if (o === f) continue;
      const dx = o.x - f.x, dy = o.y - f.y, dz = o.z - f.z;
      const d2 = dx * dx + dy * dy * 2 + dz * dz;
      if (d2 < 0.04 && d2 > 1e-8) {
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
    if (n > 0 && f.mood !== "rest") {
      const k = tr.school * (1 - w.temperament * 0.5);
      sx += (ax / n) * 1.2 * k + (cx / n - f.x) * 2.2 * k;
      sz += (az / n) * 1.2 * k + (cz / n - f.z) * 2.2 * k;
      ty += (cy / n - ty) * 0.6 * k;
    }

    // Goals.
    if (f.mood === "forage") {
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

    // Walls: look ahead along the nose and steer back toward the middle before contact.
    const look = 0.25 + f.speed * 1.2;
    const px = f.x + fx * look, pz = f.z + fz * look;
    const m = 0.12;
    let wall = 0;
    if (px > TANK.xMax - m) { sx -= (px - TANK.xMax + m) * 14; wall = 1; }
    if (px < TANK.xMin + m) { sx += (TANK.xMin + m - px) * 14; wall = 1; }
    if (pz > TANK.zMax - m) { sz -= (pz - TANK.zMax + m) * 14; wall = 1; }
    if (pz < TANK.zMin + m) { sz += (TANK.zMin + m - pz) * 14; wall = 1; }
    if (wall && Math.abs(sx) + Math.abs(sz) < 1e-3) { sx = -f.x; sz = -f.z; }

    // Turn toward the desired heading at a species-limited rate.
    const desired = Math.atan2(sx, sz);
    const maxTurn = tr.turn * moodTurn(f.mood) * (wall ? 1.8 : 1) * (0.85 + f.vigor * 0.3);
    const dyaw = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, wrap(desired - f.yaw)));
    f.yaw = wrap(f.yaw + dyaw);
    f.turnRate = dyaw / dt;

    // Speed eases toward the mood speed; tight turns slow the fish a little.
    const target = tr.speed * moodSpeed(f.mood) * (0.8 + f.vigor * 0.5) * (1 - Math.min(0.4, Math.abs(f.turnRate) / (tr.turn * 4))) * motion;
    const ease = f.mood === "dart" || f.mood === "flee" ? 7 : 1.6;
    f.speed += (target - f.speed) * Math.min(1, ease * dt);
    f.speed = Math.max(0.01 * motion, f.speed);

    const step = f.speed * dt;
    f.x += Math.sin(f.yaw) * step;
    f.z += Math.cos(f.yaw) * step;
    ty = Math.max(tr.yMin, Math.min(tr.yMax, ty));
    if (f.mood === "feed" && w.food) ty = Math.max(TANK.yMin, Math.min(TANK.yMax, w.food.y - 0.05));
    f.vy += ((ty - f.y) * 1.2 - f.vy) * Math.min(1, 2.5 * dt);
    f.y += f.vy * dt * motion;
    f.x = Math.max(TANK.xMin, Math.min(TANK.xMax, f.x));
    f.y = Math.max(TANK.yMin, Math.min(TANK.yMax, f.y));
    f.z = Math.max(TANK.zMin, Math.min(TANK.zMax, f.z));
    f.phase += dt * (2 + (f.speed / Math.max(0.05, tr.speed)) * 3);
  }
}
