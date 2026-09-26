/**
 * Backrooms director — rules, not a script.
 *
 * The sky clock is cut into episodes of `episode` seconds (default 120). Each episode picks a start
 * node in the pillar maze and walks it along open corridors only (walled edges are never entered;
 * corners are rounded inside the junction). Encounters are scheduled through the episode:
 *
 * - calm:   the creature crosses a far junction; the runner never notices.
 * - peek:   it leans out of a side opening ahead, holds, then withdraws or steps out and charges.
 * - charge: it steps out ahead, stares, then charges down the hall.
 * - ambush: it steps out at the next junction and lunges at once.
 *
 * The runner freezes for about a second, then turns down an open corridor away from it (a side
 * opening, else back the way it came) and runs, glancing back. The creature follows the runner's own
 * trail, screaming, falls behind, gives up and leaves — until the last chase: it catches the runner,
 * the camera falls on its side, and it drags the body away. Episodes are simulated once at 60 Hz and
 * sampled per frame, so the sky, the camera and the sound bed read one track. Every knob is a view
 * option (`BrOptions`), set from the UI or MCP `set_plugin`.
 */

export const BR_GRID = 4;
export const BR_PILLAR = 0.92;
export const BR_WIN = 24;
const HZ = 60;
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

/** Slot 0 float layout read by `sky/fragment.glsl`. */
export const BR_SLOT = {
  mark: 0, camX: 1, camY: 2, camZ: 3, yaw: 4, pitch: 5, roll: 6, zoom: 7,
  crX: 8, crZ: 9, crFace: 10, crGait: 11, crVis: 12, crHunch: 13, crReach: 14, crLean: 15,
  crHeadYaw: 16, crHeadRoll: 17, crFlail: 18, crClock: 19,
  hush: 20, glitch: 21, cut: 22, exposure: 23, winI: 24, winK: 25, tau: 26, panic: 27, crSpeed: 28, crType: 29,
  year: 30, month: 31, day: 32, secOfDay: 33, aspect: 34, battery: 35,
  bodyVis: 36, bodyX: 37, bodyZ: 38, bodyYaw: 39,
  optOsd: 40, optVhs: 41, optWriting: 42, optObjects: 43, optDarkness: 44, optShadows: 45,
  /** Blood trail: up to 8 (x, z) points from the kill spot, round the corners, to the body; then the count. */
  trail0: 46, trailN: 62,
} as const;
export const BR_SLOT0_FLOATS = 63;
export const BR_TRAIL_POINTS = 8;

/** Creature looks, by slot value: Kane's wire Lifeform, its hunched thick-set kin, the pale Howler, the crawling Hound, the Smiler in the dark. */
export const BR_CREATURES = ["lifeform", "hunched", "howler", "hound", "smiler"] as const;
export type BrCreature = (typeof BR_CREATURES)[number];

/** Per-type speeds (m/s): step out, charge, pursue, lunge boost. */
const CREATURE_SPEED: Record<BrCreature, [number, number, number, number]> = {
  lifeform: [2.2, 3.3, 3.3, 1.2],
  hunched: [1.9, 3.0, 3.1, 1.0],
  howler: [2.4, 3.6, 3.6, 1.1],
  hound: [2.8, 4.0, 3.9, 1.3],
  smiler: [1.6, 3.0, 3.4, 0.9],
};

/** Every view option, parsed from the `visualisation.yml` config strings (UI sliders / toggles, MCP `set_plugin`). */
export interface BrOptions {
  /** Seconds per episode. */
  episode: number;
  /** Encounters per episode, counting the last one. */
  encounters: number;
  /** The last chase of every episode ends with it catching the runner. */
  endCatch: boolean;
  /** Chance (0–1) that an earlier chase ends the episode in a catch. */
  catchChance: number;
  /** Chance (0–1) per episode that it bursts out of a corner beside you and kills at once. */
  cornerKill: number;
  /** Seconds the runner freezes after first seeing it before running. */
  freeze: number;
  /** Runs at once if it comes this close (m). */
  runDistance: number;
  creatures: BrCreature[];
  /** One creature hunts the whole episode (otherwise each encounter picks). */
  sameCreature: boolean;
  walkSpeed: number;
  runSpeed: number;
  /** Creature speed multiplier. */
  creatureSpeed: number;
  /** Chance (0–1) of an over-the-shoulder look at each chance while chased. */
  lookBacks: number;
  /** Chance (0–1) of stopping to look down side halls at a junction. */
  pauses: number;
  /** Camera bob, sway and shake multiplier. */
  handheld: number;
  musicBox: boolean;
  osd: boolean;
  vhs: number;
  writing: number;
  objects: number;
  darkness: number;
  shadows: boolean;
  volume: number;
  footsteps: number;
  breathing: number;
  heartbeat: number;
  creatureVolume: number;
}

export const BR_DEFAULTS: BrOptions = {
  episode: 120,
  encounters: 4,
  endCatch: true,
  catchChance: 0,
  cornerKill: 0.15,
  freeze: 1.0,
  runDistance: 6,
  creatures: [...BR_CREATURES],
  sameCreature: true,
  walkSpeed: 1.25,
  runSpeed: 4.2,
  creatureSpeed: 1,
  lookBacks: 0.75,
  pauses: 0.2,
  handheld: 1,
  musicBox: true,
  osd: true,
  vhs: 1,
  writing: 1,
  objects: 1,
  darkness: 1,
  shadows: true,
  volume: 1,
  footsteps: 1,
  breathing: 1,
  heartbeat: 1,
  creatureVolume: 1,
};

function num(raw: string | undefined, def: number, lo: number, hi: number, scale = 1): number {
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? clamp(v * scale, lo, hi) : def;
}
function bool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === "") return def;
  return raw === "true" || raw === "1" || raw === "on";
}

/** Config strings → options. Percent sliders arrive as 0–100 (or 0–300) and become fractions. */
export function parseBackroomsOptions(o: Record<string, string | undefined> = {}): BrOptions {
  const creatures = BR_CREATURES.filter((c) => bool(o[`creature_${c}`], true));
  return {
    episode: num(o.episode, BR_DEFAULTS.episode, 30, 600),
    encounters: Math.round(num(o.encounters, BR_DEFAULTS.encounters, 1, 8)),
    endCatch: bool(o.endCatch, BR_DEFAULTS.endCatch),
    catchChance: num(o.catchChance, BR_DEFAULTS.catchChance, 0, 1, 0.01),
    cornerKill: num(o.cornerKill, BR_DEFAULTS.cornerKill, 0, 1, 0.01),
    freeze: num(o.freeze, BR_DEFAULTS.freeze, 0.2, 4),
    runDistance: num(o.runDistance, BR_DEFAULTS.runDistance, 2, 12),
    creatures: creatures.length ? creatures : ["lifeform"],
    sameCreature: bool(o.sameCreature, BR_DEFAULTS.sameCreature),
    walkSpeed: num(o.walkSpeed, BR_DEFAULTS.walkSpeed, 0.6, 2),
    runSpeed: num(o.runSpeed, BR_DEFAULTS.runSpeed, 2.5, 6),
    creatureSpeed: num(o.creatureSpeed, BR_DEFAULTS.creatureSpeed, 0.5, 1.5, 0.01),
    lookBacks: num(o.lookBacks, BR_DEFAULTS.lookBacks, 0, 1, 0.01),
    pauses: num(o.pauses, BR_DEFAULTS.pauses, 0, 0.6, 0.01),
    handheld: num(o.handheld, BR_DEFAULTS.handheld, 0, 2, 0.01),
    musicBox: bool(o.musicBox, BR_DEFAULTS.musicBox),
    osd: bool(o.osd, BR_DEFAULTS.osd),
    vhs: num(o.vhs, BR_DEFAULTS.vhs, 0, 2, 0.01),
    writing: num(o.writing, BR_DEFAULTS.writing, 0, 3, 0.01),
    objects: num(o.objects, BR_DEFAULTS.objects, 0, 3, 0.01),
    darkness: num(o.darkness, BR_DEFAULTS.darkness, 0, 3, 0.01),
    shadows: bool(o.shadows, BR_DEFAULTS.shadows),
    volume: num(o.volume, BR_DEFAULTS.volume, 0, 1, 0.01),
    footsteps: num(o.footsteps, BR_DEFAULTS.footsteps, 0, 2, 0.01),
    breathing: num(o.breathing, BR_DEFAULTS.breathing, 0, 2, 0.01),
    heartbeat: num(o.heartbeat, BR_DEFAULTS.heartbeat, 0, 2, 0.01),
    creatureVolume: num(o.creatureVolume, BR_DEFAULTS.creatureVolume, 0, 2, 0.01),
  };
}

let opts: BrOptions = BR_DEFAULTS;
let simKey = "";

/** Options that change the simulated episodes (the rest only change the look or the mix). */
function simKeyOf(o: BrOptions): string {
  return JSON.stringify([o.episode, o.encounters, o.endCatch, o.catchChance, o.cornerKill, o.freeze, o.runDistance, o.creatures, o.sameCreature,
    o.walkSpeed, o.runSpeed, o.creatureSpeed, o.lookBacks, o.pauses, o.handheld, o.musicBox]);
}

/** Apply view options; episodes are re-simulated only when a story or motion option changed. */
export function setBackroomsOptions(o: BrOptions): void {
  opts = o;
  const key = simKeyOf(o);
  if (key !== simKey) {
    simKey = key;
    cache.clear();
  }
}

export function backroomsOptions(): BrOptions {
  return opts;
}
export const BR_MAZE_FLOATS = 48;

const SFX = { buzz: 0, box: 1, frozen: 2, pant: 3, heavy: 4, heart: 5, heartRate: 6, near: 7, kind: 8 } as const;
const SFX_FLOATS = 9;
const KINDS: BrKind[] = ["calm", "peek", "charge", "ambush"];
const STRIDE = BR_SLOT0_FLOATS + SFX_FLOATS;

export type BrKind = "calm" | "peek" | "charge" | "ambush";
export type BrEventId = "step" | "run" | "cstep" | "gasp" | "scream" | "yelp" | "drop" | "roar" | "shriek" | "screech" | "hoo" | "handle" | "tapeIn" | "tapeOut" | "box";
export interface BrEvent {
  /** Sky seconds. */
  t: number;
  id: BrEventId;
  gain: number;
  /** −1 left … 1 right, relative to where the camera points. */
  pan: number;
}
export interface BrSfx {
  buzz: number;
  box: number;
  frozen: number;
  pant: number;
  heavy: number;
  heart: number;
  heartRate: number;
  near: number;
}
export interface BrFrame {
  episode: number;
  kind: BrKind;
  creature: BrCreature;
  tau: number;
  dur: number;
  slot0: number[];
  sfx: BrSfx;
}

function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function brHash(a: number, b: number, c: number): number {
  return mix32((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0) / 4294967296;
}

function rng(seed: number): () => number {
  let s = mix32(seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D value noise in −1…1. */
function vnoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = brHash(i, seed, 7) * 2 - 1;
  const b = brHash(i + 1, seed, 7) * 2 - 1;
  return a + (b - a) * u;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/** Yaw that looks along world (dx, dz); the sky looks down −z at yaw 0. */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** Nearest grid direction 0:+x 1:+z 2:−x 3:−z. */
function dirOf(dx: number, dz: number): number {
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 2) : dz >= 0 ? 1 : 3;
}

// ---------------------------------------------------------------- maze

/** Edge from node (i, k) toward +x (axis 0) or +z (axis 1) is walled off. */
export function brEdgeBlocked(i: number, k: number, axis: number): boolean {
  return brHash(i, k, 101 + axis) < 0.3;
}

/** Corridor from node (i, k) in direction 0:+x 1:+z 2:−x 3:−z is walkable. */
export function brOpen(i: number, k: number, dir: number): boolean {
  switch (dir & 3) {
    case 0: return !brEdgeBlocked(i, k, 0);
    case 1: return !brEdgeBlocked(i, k, 1);
    case 2: return !brEdgeBlocked(i - 1, k, 0);
    default: return !brEdgeBlocked(i, k - 1, 1);
  }
}

/** Ways on from node (i, k) after arriving along `dir`, not counting straight back. */
function exits(i: number, k: number, dir: number): number {
  let n = 0;
  for (let d = 0; d < 4; d++) if (d !== ((dir + 2) & 3) && brOpen(i, k, d)) n++;
  return n;
}

function straightRun(i: number, k: number, dir: number, max = 6): number {
  let n = 0;
  while (n < max && brOpen(i + DX[dir]! * n, k + DZ[dir]! * n, dir)) n++;
  return n;
}

function sdBox2(px: number, pz: number, bx: number, bz: number): number {
  const dx = Math.abs(px) - bx;
  const dz = Math.abs(pz) - bz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}

/** Distance from (x, z) to the nearest pillar or walled edge — the solids the sky draws. */
export function brWallDist(x: number, z: number): number {
  let d = sdBox2(x - BR_GRID * Math.floor(x / BR_GRID) - 2, z - BR_GRID * Math.floor(z / BR_GRID) - 2, BR_PILLAR, BR_PILLAR);
  const ni = Math.floor(x / BR_GRID + 0.5);
  const nk = Math.floor(z / BR_GRID + 0.5);
  const ox = x - ni * BR_GRID;
  const oz = z - nk * BR_GRID;
  if (brEdgeBlocked(ni, nk, 0)) d = Math.min(d, sdBox2(ox - 2, oz, BR_PILLAR, 2));
  if (brEdgeBlocked(ni - 1, nk, 0)) d = Math.min(d, sdBox2(ox + 2, oz, BR_PILLAR, 2));
  if (brEdgeBlocked(ni, nk, 1)) d = Math.min(d, sdBox2(ox, oz - 2, 2, BR_PILLAR));
  if (brEdgeBlocked(ni, nk - 1, 1)) d = Math.min(d, sdBox2(ox, oz + 2, 2, BR_PILLAR));
  return d;
}

function lineClear(ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.35);
  for (let s = 1; s < n; s++) {
    const w = s / n;
    if (brWallDist(ax + (bx - ax) * w, az + (bz - az) * w) < 0.02) return false;
  }
  return true;
}

/** Walled edges in a BR_WIN² node window from (oi, ok): 2 bits per node, 24 bits per float. */
export function brMazeWindow(oi: number, ok: number): number[] {
  const out = new Array<number>(BR_MAZE_FLOATS).fill(0);
  for (let lz = 0; lz < BR_WIN; lz++) {
    for (let lx = 0; lx < BR_WIN; lx++) {
      for (let a = 0; a < 2; a++) {
        if (!brEdgeBlocked(oi + lx, ok + lz, a)) continue;
        const b = (lz * BR_WIN + lx) * 2 + a;
        out[Math.floor(b / 24)]! += 2 ** (b % 24);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- route

interface Vec { x: number; z: number }

/** Centre-line polyline through nodes; corners with a radius are cut with a quadratic arc inside the junction. */
class Route {
  pts: Vec[] = [];
  cum: number[] = [];
  rad: number[] = [];

  push(p: Vec): void {
    const n = this.pts.length;
    this.cum.push(n ? this.cum[n - 1]! + Math.hypot(p.x - this.pts[n - 1]!.x, p.z - this.pts[n - 1]!.z) : 0);
    this.pts.push(p);
    this.rad.push(0);
  }

  get end(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  sample(u: number): { x: number; z: number; tx: number; tz: number } {
    const n = this.pts.length;
    if (n < 2) return { x: this.pts[0]?.x ?? 0, z: this.pts[0]?.z ?? 0, tx: 0, tz: -1 };
    u = clamp(u, 0, this.end);
    let j = 0;
    while (j < n - 2 && this.cum[j + 1]! <= u) j++;
    for (const c of [j, j + 1]) {
      if (c <= 0 || c >= n - 1) continue;
      const r = this.rad[c]!;
      if (r <= 0 || Math.abs(u - this.cum[c]!) >= r) continue;
      const P = this.pts[c]!;
      const a = this.pts[c - 1]!;
      const b = this.pts[c + 1]!;
      const li = Math.hypot(P.x - a.x, P.z - a.z) || 1;
      const lo = Math.hypot(b.x - P.x, b.z - P.z) || 1;
      const A = { x: P.x - ((P.x - a.x) / li) * r, z: P.z - ((P.z - a.z) / li) * r };
      const B = { x: P.x + ((b.x - P.x) / lo) * r, z: P.z + ((b.z - P.z) / lo) * r };
      const w = (u - (this.cum[c]! - r)) / (2 * r);
      const m = 1 - w;
      const tx = 2 * m * (P.x - A.x) + 2 * w * (B.x - P.x);
      const tz = 2 * m * (P.z - A.z) + 2 * w * (B.z - P.z);
      const tl = Math.hypot(tx, tz) || 1;
      return {
        x: m * m * A.x + 2 * m * w * P.x + w * w * B.x,
        z: m * m * A.z + 2 * m * w * P.z + w * w * B.z,
        tx: tx / tl,
        tz: tz / tl,
      };
    }
    const a = this.pts[j]!;
    const b = this.pts[j + 1]!;
    const len = this.cum[j + 1]! - this.cum[j]! || 1;
    const w = (u - this.cum[j]!) / len;
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
  }
}

/** Dense trail of points with arc length; the creature follows the runner along it. */
class Trail {
  x: number[] = [];
  z: number[] = [];
  s: number[] = [];

  add(x: number, z: number): void {
    const n = this.x.length;
    if (n) {
      const d = Math.hypot(x - this.x[n - 1]!, z - this.z[n - 1]!);
      if (d < 0.05) return;
      this.s.push(this.s[n - 1]! + d);
    } else this.s.push(0);
    this.x.push(x);
    this.z.push(z);
  }

  get end(): number {
    return this.s[this.s.length - 1] ?? 0;
  }

  at(d: number): { x: number; z: number; tx: number; tz: number } {
    const n = this.x.length;
    if (n === 0) return { x: 0, z: 0, tx: 0, tz: -1 };
    if (n === 1) return { x: this.x[0]!, z: this.z[0]!, tx: 0, tz: -1 };
    d = clamp(d, 0, this.end);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const seg = this.s[hi]! - this.s[lo]! || 1;
    const w = (d - this.s[lo]!) / seg;
    const tx = (this.x[hi]! - this.x[lo]!) / seg;
    const tz = (this.z[hi]! - this.z[lo]!) / seg;
    return { x: this.x[lo]! + (this.x[hi]! - this.x[lo]!) * w, z: this.z[lo]! + (this.z[hi]! - this.z[lo]!) * w, tx, tz };
  }
}

// ---------------------------------------------------------------- episodes

export function brEpisodeAt(t: number): { e: number; t0: number; dur: number } {
  const L = opts.episode;
  const e = Math.floor(Math.max(0, t) / L);
  return { e, t0: e * L, dur: L };
}

/** Where the runner is when an episode ends, so the next one can carry straight on. */
interface StartState {
  x: number;
  z: number;
  li: number;
  lk: number;
  dir: number;
  yaw: number;
  camH: number;
  phi: number;
}

interface Track {
  e: number;
  t0: number;
  dur: number;
  kind: BrKind;
  creature: BrCreature;
  endCaught: boolean;
  end: StartState;
  n: number;
  f: Float32Array;
  events: BrEvent[];
}

type Walk = "explore" | "pause" | "approach" | "stare" | "brake" | "flee" | "recover" | "rest" | "caught";
type Crea = "lunge" | "drag" | "off" | "lurk" | "lean" | "hold" | "withdraw" | "stepout" | "stare" | "charge" | "pursue" | "giveup" | "stand" | "leave" | "cross";

function pickKind(r: number): BrKind {
  return r < 0.16 ? "calm" : r < 0.4 ? "peek" : r < 0.82 ? "charge" : "ambush";
}

function simulate(e: number, t0: number, dur: number, start: StartState | null): Track {
  const O = opts;
  const R = rng(Math.imul(e + 1, 2654435761));
  const pool = O.creatures;
  let creature: BrCreature = pool[Math.floor(R() * pool.length)]!;
  const firstCreature = creature;
  let kind: BrKind = "calm";
  let willCatch = false;
  const speedsOf = (c: BrCreature): number[] => CREATURE_SPEED[c].map((v) => v * O.creatureSpeed);
  let [spStep, spCharge, spPursue, spLunge] = speedsOf(creature) as [number, number, number, number];
  // Encounters spread through the episode; the last one (after finalAt) always ends in a catch.
  const finalAt = O.endCatch ? Math.max(6, dur - 34) : Infinity;
  let encounterActive = false;
  let encounterCount = 0;
  let finalStarted = false;
  let forcedEnd = false;
  // Now and then it waits round a corner and takes you as you pass.
  let cornerAt = R() < O.cornerKill ? 14 + R() * Math.max(6, dur - 70) : Infinity;
  let cornerPath = null as Trail | null;
  /** Corners of the drag path (distance along it, x, z), found once at the kill. */
  let dragCorners: number[][] = [];
  let nextEncounterAt = clamp(6 + R() * 10, 4, Math.max(5, Math.min(dur * 0.3, finalAt - 2)));
  let restFor = 3;
  let nextShriek = 0;
  const noiseSeed = Math.floor(R() * 100000);
  const n = Math.ceil(dur * HZ) + 1;
  const f = new Float32Array(n * STRIDE);
  const events: BrEvent[] = [];
  const dt = 1 / HZ;

  const node = (i: number, k: number): Vec => ({ x: i * BR_GRID, z: k * BR_GRID });
  const route = new Route();
  const trail = new Trail();
  let dir = 0;
  let li = 0;
  let lk = 0;
  /** Start on a node with a long open corridor ahead. */
  const freshStart = (): void => {
    let ci = Math.floor(R() * 600) - 300;
    const ck = Math.floor(R() * 600) - 300;
    for (let tries = 0; tries < 40; tries++) {
      let best = -1;
      for (let d = 0; d < 4; d++) {
        const run = straightRun(ci, ck, d) + R() * 0.6;
        if (run > best) {
          best = run;
          dir = d;
        }
      }
      if (best >= 2) break;
      ci += 1;
    }
    route.pts = [];
    route.cum = [];
    route.rad = [];
    route.push(node(ci, ck));
    li = ci + DX[dir]!;
    lk = ck + DZ[dir]!;
    route.push(node(li, lk));
    trail.x = [];
    trail.z = [];
    trail.s = [];
  };
  if (start) {
    // Carry straight on from where the last episode left the runner.
    dir = start.dir;
    li = start.li;
    lk = start.lk;
    route.push({ x: start.x, z: start.z });
    route.push(node(li, lk));
  } else freshStart();
  // A fresh tape fades up from static; a carried-on one does not.
  let tapeStartAt = start ? -10 : 0;

  // Runner.
  let walk: Walk = "explore";
  let u = 0;
  let v = 0;
  let stopU = Infinity;
  let pauseUntil = 0;
  let pauseSides: number[] = [];
  let walkT = 0;
  let fleeFast = true;
  let glanceAt = -1;
  let nextGlance = 0;
  let glanceStart = -1;
  let glanceEnd = 0;
  let glanceChecked = false;
  let freakUntil = -1;
  let lookBackAt = -1;
  let spotted = -1;
  let phi = start ? start.phi : 0;
  let yaw = start ? start.yaw : yawOf(DX[dir]!, DZ[dir]!);
  let yawVel = 0;
  let pitch = -0.03;
  let pitchVel = 0;
  let roll = 0;
  let rollVel = 0;
  let camH = start ? start.camH : 1.5;
  let panic = 0.04;
  let exert = 0;
  let prevYaw = yaw;

  // Creature.
  let crea: Crea = "off";
  let creaT = 0;
  let cx = 0;
  let cz = 0;
  let cFace = 0;
  let cGait = 0;
  let cVis = 0;
  let cHunch = 0.35;
  let cReach = 0;
  let cLean = 0;
  let cHeadYaw = 0;
  let cHeadRoll = 0;
  let headTgtYaw = 0;
  let headTgtRoll = 0;
  let nextTwitch = 0;
  let cFlail = 0;
  let cClock = 0;
  let cSpeed = 0;
  let cd = 0;
  let cTrack = null as Trail | null;
  let sideVec: Vec = { x: 0, z: 0 };
  let lurkP: Vec = { x: 0, z: 0 };
  let peekP: Vec = { x: 0, z: 0 };
  let leanSign = 1;
  let peekCharges = false;
  let pursueDur = 0;
  let holdUntil = 0;
  let lungeUntil = 0;
  let trailFrom = -1;
  let cornered = false;
  let safeFor = 0;
  let fleeTurns = 0;
  let spotIdx = 0;
  let spotPos: Vec = { x: 0, z: 0 };
  let stumbleAt = -1;
  let stumbleUntil = -1;
  let caughtAt = -1;
  let dragPath = null as Trail | null;
  let dragD = 0;
  let bodyVis = 0;
  let bodyX = 0;
  let bodyZ = 0;
  let bodyYaw = 0;
  const lastOut = { x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const dropFrom = { x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const struggleEnd = { x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const dropTo = { x: 0, z: 0, yaw: 0, roll: 0 };
  let k2: BrKind = kind;
  const held = { x: 0, z: 0, gait: 0, clock: 0, speed: 0 };
  let boxAt = -1;

  const creaStartTrack = (from: Vec, to: Vec): void => {
    cTrack = new Trail();
    cTrack.add(from.x, from.z);
    const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25));
    for (let s = 1; s <= steps; s++) cTrack.add(from.x + ((to.x - from.x) * s) / steps, from.z + ((to.z - from.z) * s) / steps);
    cd = 0;
  };

  /** Commit the corridor after the junction the runner is heading to. `afterStop`: it is standing on that junction. */
  const decideNext = (tau: number, afterStop = false): void => {
    // Encounter rules fire as the runner commits to its next junction.
    const isFinal = tau >= finalAt && !finalStarted;
    const earlyOk = tau < finalAt - 8 && encounterCount < O.encounters - (O.endCatch ? 1 : 0) && tau < dur - 10;
    if (!encounterActive && (walk as Walk) === "explore" && tau >= nextEncounterAt && (isFinal ? tau < dur - 14 : earlyOk)) {
      const late = tau > nextEncounterAt + 4;
      kind = isFinal ? (R() < 0.6 ? "charge" : "ambush") : pickKind(R());
      const tryAt = (minM: number, maxM: number, needBoth: boolean): { m: number; side: number } | null => {
        const run = straightRun(li, lk, dir);
        for (let m = maxM; m >= minM; m--) {
          if (run < m) continue;
          const Ci = li + DX[dir]! * m;
          const Ck = lk + DZ[dir]! * m;
          const sl = (dir + 1) & 3;
          const sr = (dir + 3) & 3;
          const ol = brOpen(Ci, Ck, sl);
          const or = brOpen(Ci, Ck, sr);
          if (needBoth ? ol && or : ol || or) {
            const side = ol && or ? (R() < 0.5 ? sl : sr) : ol ? sl : sr;
            return { m, side };
          }
        }
        return null;
      };
      let hit: { m: number; side: number } | null = null;
      let chosen: BrKind = kind;
      if (kind === "charge") hit = tryAt(late ? 2 : 3, 4, false);
      else if (kind === "peek") hit = tryAt(2, 3, false);
      else if (kind === "ambush") hit = tryAt(1, 1, false);
      else hit = tryAt(late ? 4 : 5, 6, true);
      if (!hit && late && kind !== "calm") {
        hit = tryAt(2, 3, false);
        chosen = isFinal ? "charge" : "peek";
      }
      if (hit) {
        encounterActive = true;
        encounterCount++;
        if (isFinal) finalStarted = true;
        k2 = chosen;
        if (!O.sameCreature) {
          creature = pool[Math.floor(R() * pool.length)]!;
          [spStep, spCharge, spPursue, spLunge] = speedsOf(creature) as [number, number, number, number];
        }
        // Sometimes it gets you: always on the last chase, by chance on an earlier one.
        willCatch = isFinal || (((k2 as BrKind) === "charge" || (k2 as BrKind) === "ambush") && R() < O.catchChance);
        spotted = -1;
        glanceStart = -1;
        freakUntil = -1;
        stumbleAt = -1;
        stumbleUntil = -1;
        cornered = false;
        trailFrom = -1;
        cSpeed = 0;
        lungeUntil = 0;
        safeFor = 0;
        const C = node(li + DX[dir]! * hit.m, lk + DZ[dir]! * hit.m);
        sideVec = { x: DX[hit.side]!, z: DZ[hit.side]! };
        const back = { x: -DX[dir]!, z: -DZ[dir]! };
        creaT = 0;
        cVis = 0;
        if ((k2 as BrKind) === "calm") {
          crea = "cross";
          cx = C.x - sideVec.x * 3.6;
          cz = C.z - sideVec.z * 3.6;
          creaStartTrack({ x: cx, z: cz }, { x: C.x + sideVec.x * 3.6, z: C.z + sideVec.z * 3.6 });
        } else {
          lurkP = { x: C.x + sideVec.x * 2.4, z: C.z + sideVec.z * 2.4 };
          peekP = { x: C.x + sideVec.x * 1.45 + back.x * 0.1, z: C.z + sideVec.z * 1.45 + back.z * 0.1 };
          // Lean toward the main hall: the creature's right is (cos f, sin f) for facing f.
          const f0 = yawOf(back.x, back.z);
          leanSign = -sideVec.x * Math.cos(f0) - sideVec.z * Math.sin(f0) >= 0 ? 1 : -1;
          cx = lurkP.x;
          cz = lurkP.z;
          crea = "lurk";
          peekCharges = R() < 0.45;
          if ((k2 as BrKind) !== "ambush") {
            // Stop at this junction and watch.
            walk = "approach";
            stopU = route.end;
            return;
          }
          // Ambush: keep walking straight at it so the escape is back the way it came.
          route.rad[route.pts.length - 1] = 0;
          li += DX[dir]!;
          lk += DZ[dir]!;
          route.push(node(li, lk));
          return;
        }
      }
    }
    // Choose the next corridor: open edges only, never straight back unless it is a dead end.
    const rev = (dir + 2) & 3;
    const opts: { d: number; w: number }[] = [];
    const fleeing = (walk as Walk) === "flee" || (walk as Walk) === "recover";
    for (let d = 0; d < 4; d++) {
      if (d === rev || !brOpen(li, lk, d)) continue;
      const run = straightRun(li, lk, d);
      let w = d === dir ? 2.0 + 0.35 * run : 1.0 + 0.2 * run;
      if (!encounterActive && tau > nextEncounterAt - 6) w *= 0.5 + 0.5 * run;
      if (fleeing) {
        const tx = cx - li * BR_GRID;
        const tz = cz - lk * BR_GRID;
        const dist = Math.hypot(tx, tz);
        if (cVis > 0.2 && dist < 16 && (DX[d]! * tx + DZ[d]! * tz) > 0.4 * dist) w = 0.02;
        else w = d === dir ? 1.0 : 1.7;
      }
      // Never head for the junction it is standing at.
      if (cVis > 0.2 && Math.hypot(cx - (li + DX[d]!) * BR_GRID, cz - (lk + DZ[d]!) * BR_GRID) < 7) w *= 0.001;
      // Look one junction ahead: avoid corridors that end in a dead end.
      if (exits(li + DX[d]!, lk + DZ[d]!, d) === 0) w *= fleeing ? 0.03 : 0.3;
      opts.push({ d, w });
    }
    let nd = rev;
    if (opts.length) {
      let sum = 0;
      for (const o of opts) sum += o.w;
      let r = R() * sum;
      nd = opts[opts.length - 1]!.d;
      for (const o of opts) {
        r -= o.w;
        if (r <= 0) {
          nd = o.d;
          break;
        }
      }
    }
    if (nd === rev && fleeing && cVis > 0.3 && Math.hypot(cx - li * BR_GRID, cz - lk * BR_GRID) < 18) {
      // Cornered: never run back into it. Stop at the dead end — it may give up, or it may not.
      if (R() < 0.6) willCatch = true;
      stopU = route.end;
      walk = "rest";
      walkT = 0;
      lookBackAt = 0.2;
      cornered = true;
      return;
    }
    if (!afterStop) {
      // Look-around pauses at junctions with side halls, and a stop before turning back at a dead end.
      const sides = [(dir + 1) & 3, (dir + 3) & 3].filter((d) => brOpen(li, lk, d));
      const pauseHere = (walk as Walk) === "explore" && nd !== rev && sides.length > 0 && tau > 2 && tau < nextEncounterAt - 4 && R() < O.pauses;
      if (pauseHere || nd === rev) {
        stopU = route.end;
        if ((walk as Walk) === "explore") {
          walk = "pause";
          pauseSides = pauseHere ? sides : [];
          pauseUntil = -1;
        }
        return;
      }
    }
    // Arc only as wide as the distance still to walk before the corner, so the path never jumps.
    const cIdx = route.pts.length - 1;
    route.rad[cIdx] = afterStop || nd === dir ? 0 : clamp(route.cum[cIdx]! - u - 0.05, 0, 0.95);
    if (fleeing && nd !== dir) fleeTurns++;
    dir = nd;
    li += DX[dir]!;
    lk += DZ[dir]!;
    route.push(node(li, lk));
  };

  /** Turn away from the creature at the current spot: a side opening at a node, else back along the trail. */
  const startFlee = (tau: number, fast: boolean): void => {
    walk = "flee";
    fleeFast = fast;
    walkT = 0;
    fleeTurns = 0;
    glanceAt = fast ? -1 : 2.6;
    nextGlance = 1.2 + R() * 1.0;
    glanceStart = -1;
    freakUntil = -1;
    const here = route.sample(u);
    const last = route.pts.length - 1;
    const atNode = u >= route.end - 0.3;
    const tx = cx - here.x;
    const tz = cz - here.z;
    const dist = Math.hypot(tx, tz) || 1;
    let nd = -1;
    if (atNode) {
      const cand: number[] = [];
      for (let d = 0; d < 4; d++) {
        if (!brOpen(li, lk, d)) continue;
        if ((DX[d]! * tx + DZ[d]! * tz) / dist > 0.3) continue;
        if (d === ((dir + 2) & 3)) continue;
        cand.push(d);
      }
      const live = cand.filter((d) => exits(li + DX[d]!, lk + DZ[d]!, d) > 0);
      const pool = live.length ? live : cand;
      if (pool.length) nd = pool[Math.floor(R() * pool.length)]!;
    }
    const nr = new Route();
    nr.push({ x: here.x, z: here.z });
    if (nd >= 0) {
      dir = nd;
      li += DX[dir]!;
      lk += DZ[dir]!;
    } else {
      // Back the way it came: to the start of the segment it is on (a node it already walked through).
      let j = 0;
      while (j < last - 1 && route.cum[j + 1]! <= u) j++;
      const back = atNode ? route.pts[last - 1]! : route.pts[j]!;
      li = Math.round(back.x / BR_GRID);
      lk = Math.round(back.z / BR_GRID);
      dir = dirOf(back.x - here.x, back.z - here.z);
    }
    nr.push(node(li, lk));
    route.pts = nr.pts;
    route.cum = nr.cum;
    route.rad = nr.rad;
    u = 0;
    stopU = Infinity;
    if (trailFrom < 0) trailFrom = trail.x.length - 1;
    events.push({ t: t0 + tau, id: "handle", gain: 0.8, pan: 0 });
    // First close sight of it: scream and run.
    if (fast && cVis > 0.5 && dist < 7) events.push({ t: t0 + tau + 0.08, id: "scream", gain: 1, pan: 0 });
  };

  /** A creature sound at its position: quieter with distance, duller through walls, panned to where it is. */
  const creatureCue = (tau: number, id: BrEventId, base: number, floor = 0): void => {
    if (caughtAt >= 0) return;
    const w = route.sample(u);
    const d = Math.hypot(cx - w.x, cz - w.z);
    const through = lineClear(w.x, w.z, cx, cz) ? 1 : 0.55;
    const rel = wrapPi(yawOf(cx - w.x, cz - w.z) - yaw);
    events.push({ t: t0 + tau, id, gain: Math.max(floor, base * through * clamp(4 / (d + 3), 0.06, 1)), pan: clamp(Math.sin(rel), -1, 1) });
  };

  for (let i = 0; i < n; i++) {
    const tau = i * dt;

    // ----- creature brain
    creaT += dt;
    const walkerPos = route.sample(u);
    const dxw = walkerPos.x - cx;
    const dzw = walkerPos.z - cz;
    const distW = Math.hypot(dxw, dzw);
    let cTargetSpeed = 0;
    switch (crea as Crea) {
      case "lurk": {
        cVis = 0;
        const wait = (k2 as BrKind) === "ambush" ? 0.05 : (k2 as BrKind) === "charge" ? 0.9 : 1.2;
        if (creaT > wait) {
          creaT = 0;
          cVis = 1;
          if ((k2 as BrKind) === "peek") {
            crea = "lean";
            cx = peekP.x;
            cz = peekP.z;
            creatureCue(tau, "screech", 0.8);
          } else {
            crea = "stepout";
            const C = { x: lurkP.x - sideVec.x * 2.4, z: lurkP.z - sideVec.z * 2.4 };
            creaStartTrack(lurkP, C);
            if ((k2 as BrKind) === "ambush") creatureCue(tau, "roar", 1, 0.6);
          }
        }
        break;
      }
      case "lean":
        cLean = clamp(creaT / 0.55, 0, 1) * leanSign;
        if (creaT > 0.55) {
          crea = "hold";
          creaT = 0;
        }
        break;
      case "hold":
        if (creaT > 1.5 + (peekCharges ? 0.3 : 0.6)) {
          creaT = 0;
          if (peekCharges) {
            crea = "stepout";
            const C = { x: lurkP.x - sideVec.x * 2.4, z: lurkP.z - sideVec.z * 2.4 };
            creaStartTrack({ x: cx, z: cz }, C);
            cLean = 0;
          } else crea = "withdraw";
        }
        break;
      case "withdraw":
        cLean = leanSign * clamp(1 - creaT / 0.35, 0, 1);
        if (creaT > 0.35) {
          cx += (lurkP.x - cx) * 0.2;
          cz += (lurkP.z - cz) * 0.2;
        }
        if (creaT > 0.7) {
          cVis = 0;
          crea = "off";
        }
        break;
      case "stepout":
        cTargetSpeed = (k2 as BrKind) === "ambush" ? spStep + 0.8 : spStep;
        if (cTrack && cd >= cTrack.end - 0.02) {
          creaT = 0;
          if ((k2 as BrKind) === "ambush") {
            crea = "charge";
            if (spotted >= 0) {
              creaStartTrack({ x: cx, z: cz }, spotPos);
              trailFrom = spotIdx + 1;
            }
          } else {
            crea = "stare";
          }
        }
        break;
      case "stare":
        cTargetSpeed = 0;
        if (creaT > 0.45 + ((k2 as BrKind) === "peek" ? 0.1 : 0.25)) {
          crea = "charge";
          creaT = 0;
          creatureCue(tau, "roar", 1, 0.6);
          // Charge line: down the hall to where the runner saw it, then along the runner's own trail.
          if (spotted < 0) {
            spotIdx = Math.max(0, trail.x.length - 1);
            spotPos = { x: walkerPos.x, z: walkerPos.z };
          }
          creaStartTrack({ x: cx, z: cz }, spotPos);
          trailFrom = spotIdx + 1;
        }
        break;
      case "charge": {
        const surge = 0.5 * vnoise(tau * 2.3, noiseSeed + 5);
        cTargetSpeed = spCharge + ((k2 as BrKind) === "ambush" ? 0.2 : 0) + surge;
        if (!cTrack || (crea as Crea) !== "charge") break;
        if ((walk as Walk) === "flee") {
          crea = "pursue";
          creaT = 0;
          pursueDur = 3.5 + R() * 2.5;
        } else if (cd >= cTrack.end - 3.4) {
          cTargetSpeed = 0.4;
        }
        break;
      }
      case "pursue":
        // Lunges now and then, so a look back sometimes finds it right there.
        if (tau >= lungeUntil && R() < dt * 0.7) lungeUntil = tau + 0.7 + R() * 0.6;
        cTargetSpeed = spPursue - 0.2 * creaT + 0.4 * vnoise(tau * 2.1, noiseSeed + 9) + (tau < lungeUntil ? spLunge : 0);
        if (willCatch && (stumbleUntil > 0 || cornered)) cTargetSpeed += 1.2;
        if (!willCatch && (creaT > pursueDur || (cornered && distW < 9))) {
          crea = "giveup";
          creaT = 0;
        }
        break;
      case "giveup":
        cTargetSpeed = 0;
        if (creaT > 0.9) {
          crea = "stand";
          creaT = 0;
          if (R() < 0.7) creatureCue(tau, "hoo", 1);
        }
        break;
      case "stand":
        if (creaT > 1.3) {
          crea = "leave";
          creaT = 0;
        }
        break;
      case "leave":
        cTargetSpeed = -1.1;
        if (creaT > 3.2) {
          cVis = clamp(cVis - dt * 2, 0, 1);
          if (cVis <= 0) crea = "off";
        }
        break;
      case "lunge":
        // Out of the side hall and onto you, no warning.
        cTargetSpeed = 6.5;
        cSpeed = 6.5;
        break;
      case "drag":
        // Stoop over the body, then haul it away the way they came, silently.
        cTargetSpeed = creaT > 2.0 ? 0.85 : 0;
        if (dragPath && creaT > 0.9) {
          dragD = Math.min(dragD + cSpeed * dt, dragPath.end);
          const dp = dragPath.at(dragD);
          const k = clamp((creaT - 0.9) * 3, 0, 1);
          cx += (dp.x - cx) * k;
          cz += (dp.z - cz) * k;
          cFace = yawOf(dp.tx, dp.tz);
          if (creaT > 1.3) bodyVis = 1;
          if (dragD > 24) cVis = 0;
        }
        break;
      case "cross":
        cVis = 1;
        cTargetSpeed = 1.25;
        if (cTrack && cd >= cTrack.end - 0.05) {
          cVis = 0;
          crea = "off";
          encounterActive = false;
          nextEncounterAt = tau + 8 + R() * 10;
        }
        break;
      default:
        break;
    }

    // Once the runner flees, the creature's track extends along the runner's trail.
    if (cTrack && trailFrom >= 0 && ((crea as Crea) === "charge" || (crea as Crea) === "pursue" || (crea as Crea) === "giveup" || (crea as Crea) === "stand" || (crea as Crea) === "leave")) {
      const track: Trail = cTrack;
      for (; trailFrom < trail.x.length; trailFrom++) track.add(trail.x[trailFrom]!, trail.z[trailFrom]!);
    }

    // Creature speed and position along its track (dropped frames while it runs).
    cSpeed += (cTargetSpeed - cSpeed) * clamp(dt * (Math.abs(cTargetSpeed) > Math.abs(cSpeed) ? 3.5 : 5), 0, 1);
    if (cTrack && (crea as Crea) !== "lurk" && (crea as Crea) !== "lean" && (crea as Crea) !== "hold" && (crea as Crea) !== "withdraw" && (crea as Crea) !== "off" && (crea as Crea) !== "drag") {
      cd = clamp(cd + cSpeed * dt, 0, cTrack.end);
      if ((crea as Crea) === "charge" || (crea as Crea) === "pursue") cd = Math.min(cd, Math.max(0, cTrack.end - (willCatch ? 0.7 : 3.4)));
      const p = cTrack.at(cd);
      cx = p.x;
      cz = p.z;
    }
    // It screams while it chases.
    if (((crea as Crea) === "charge" || (crea as Crea) === "pursue") && cVis > 0.5 && tau >= nextShriek) {
      if (nextShriek > 0 && distW < 30) creatureCue(tau, "shriek", 1, 0.4);
      nextShriek = tau + 1.1 + R() * 1.5;
    } else if ((crea as Crea) !== "charge" && (crea as Crea) !== "pursue") nextShriek = tau + 0.25;
    const cMove = Math.abs(cSpeed);
    const stride = 0.75 + 0.28 * cMove;
    const prevCG = cGait;
    cGait += (cMove * dt / stride) * Math.PI;
    cClock += dt * (1 + 0.8 * cMove);
    // Head twitches: snap to a new angle, hold, snap again.
    if (tau >= nextTwitch) {
      const wild = (crea as Crea) === "charge" || (crea as Crea) === "pursue" || (crea as Crea) === "stare" ? 1 : 0.55;
      headTgtYaw = (R() * 2 - 1) * 0.55 * wild;
      headTgtRoll = (R() * 2 - 1) * 0.6 * wild;
      nextTwitch = tau + 0.2 + R() * (wild > 0.9 ? 0.5 : 1.1);
    }
    cHeadYaw += (headTgtYaw - cHeadYaw) * clamp(dt * 22, 0, 1);
    cHeadRoll += (headTgtRoll - cHeadRoll) * clamp(dt * 22, 0, 1);
    const hunchT = (crea as Crea) === "drag" ? 0.85 : (crea as Crea) === "charge" || (crea as Crea) === "pursue" ? 0.9 : (crea as Crea) === "stare" || (crea as Crea) === "stepout" ? 0.55 : (crea as Crea) === "lean" || (crea as Crea) === "hold" ? 0.45 : 0.3;
    cHunch += (hunchT - cHunch) * clamp(dt * 4, 0, 1);
    const reachT = (crea as Crea) === "charge" || (crea as Crea) === "pursue" ? 1 : (crea as Crea) === "stare" ? 0.35 : 0;
    cReach += (reachT - cReach) * clamp(dt * 5, 0, 1);
    const flailT = (crea as Crea) === "charge" || (crea as Crea) === "pursue" ? 1 : (crea as Crea) === "stare" ? 0.25 : 0;
    cFlail += (flailT - cFlail) * clamp(dt * 6, 0, 1);
    if ((crea as Crea) === "stepout" || (crea as Crea) === "cross" || (crea as Crea) === "leave" || (((crea as Crea) === "charge" || (crea as Crea) === "pursue") && cSpeed > 0.6)) {
      const tr = cTrack?.at(cd);
      if (tr) cFace = yawOf(cSpeed >= 0 ? tr.tx : -tr.tx, cSpeed >= 0 ? tr.tz : -tr.tz);
    } else if ((crea as Crea) !== "off" && (crea as Crea) !== "lurk" && (crea as Crea) !== "drag") {
      cFace = yawOf(dxw, dzw);
    }
    if ((crea as Crea) === "cross" || (crea as Crea) === "leave") cHunch += (0.4 - cHunch) * clamp(dt * 3, 0, 1);
    // Dropped frames: hold the last pose for a few video frames, then jump.
    const jerky = (crea as Crea) === "charge" || (crea as Crea) === "pursue" || (crea as Crea) === "stepout" || (crea as Crea) === "stare";
    if (tau >= holdUntil) {
      held.x = cx;
      held.z = cz;
      held.gait = cGait;
      held.clock = cClock;
      held.speed = Math.abs(cSpeed);
      if (jerky && R() < dt * 5.5) holdUntil = tau + 0.05 + R() * 0.12;
    }
    if (caughtAt < 0 && cVis > 0.5 && cMove > 0.3 && Math.floor(cGait / Math.PI) > Math.floor(prevCG / Math.PI)) {
      const rel = wrapPi(yawOf(cx - walkerPos.x, cz - walkerPos.z) - yaw);
      events.push({ t: t0 + tau, id: "cstep", gain: Math.min(1, clamp(2.5 / (distW + 1), 0.03, 1) * (0.5 + 0.2 * cMove) * (lineClear(walkerPos.x, walkerPos.z, cx, cz) ? 1 : 0.55)), pan: clamp(Math.sin(rel), -1, 1) });
    }

    // An earlier catch: once the tape has broken up, a new one starts somewhere else and carries on.
    if (caughtAt >= 0 && tau > caughtAt + 12.2 && tau < dur - 30) {
      freshStart();
      walk = "explore";
      u = 0;
      v = 0;
      stopU = Infinity;
      walkT = 0;
      yaw = yawOf(DX[dir]!, DZ[dir]!);
      prevYaw = yaw;
      yawVel = 0;
      pitch = -0.03;
      roll = 0;
      camH = 1.5;
      panic = 0.05;
      exert = 0;
      caughtAt = -1;
      bodyVis = 0;
      dragPath = null;
      crea = "off";
      cVis = 0;
      cTrack = null;
      willCatch = false;
      encounterActive = false;
      nextEncounterAt = tau + 8 + R() * 8;
      spotted = -1;
      stumbleAt = -1;
      stumbleUntil = -1;
      cornered = false;
      trailFrom = -1;
      glanceStart = -1;
      freakUntil = -1;
      tapeStartAt = tau;
    }

    // ----- runner brain
    walkT += dt;
    if (((walk as Walk) === "explore" || (walk as Walk) === "flee" || (walk as Walk) === "recover") && u >= route.end - 2.6 && stopU === Infinity) decideNext(tau);
    if (((walk as Walk) === "flee" || (walk as Walk) === "recover") && stopU < Infinity && u >= stopU - 0.02 && v < 0.15) {
      // Dead end while running: stop, turn, go back.
      stopU = Infinity;
      decideNext(tau, true);
    }
    if ((walk as Walk) === "pause" && pauseUntil < 0 && u >= stopU - 0.02 && v < 0.1) {
      pauseUntil = tau + (pauseSides.length ? 1.8 + R() * 0.8 : 0.9);
      walkT = 0;
    }
    if ((walk as Walk) === "pause" && pauseUntil > 0 && tau >= pauseUntil) {
      walk = "explore";
      stopU = Infinity;
      pauseUntil = 0;
      decideNext(tau, true);
    }
    const creatureSeen = cVis > 0.5 && (crea as Crea) !== "lurk" && (crea as Crea) !== "cross" && (crea as Crea) !== "off" && (crea as Crea) !== "lunge";
    // Corner kill: passing a junction with a side hall, 1–2 m short of it, it comes out of that hall.
    if (tau >= cornerAt && caughtAt < 0 && !encounterActive && (walk as Walk) === "explore" && tau < dur - 16) {
      let j = 0;
      while (j < route.pts.length - 2 && route.cum[j + 1]! <= u) j++;
      const toNode = route.cum[j + 1]! - u;
      const A = route.pts[j]!;
      const B = route.pts[j + 1]!;
      if (toNode > 1.0 && toNode < 2.2 && Math.hypot(B.x - A.x, B.z - A.z) > 3) {
        const ni = Math.round(B.x / BR_GRID);
        const nk = Math.round(B.z / BR_GRID);
        const along = dirOf(B.x - A.x, B.z - A.z);
        const sides = [(along + 1) & 3, (along + 3) & 3].filter((d) => brOpen(ni, nk, d));
        if (sides.length) {
          const side = sides[Math.floor(R() * sides.length)]!;
          cornerAt = Infinity;
          encounterActive = true;
          willCatch = true;
          k2 = "ambush";
          cx = B.x + DX[side]! * 2.3;
          cz = B.z + DZ[side]! * 2.3;
          // Out of its hall to the middle of the junction, then straight down yours at you — never through a pillar.
          creaStartTrack({ x: cx, z: cz }, { x: B.x, z: B.z });
          const lungeTo = { x: walkerPos.x + walkerPos.tx * 0.8, z: walkerPos.z + walkerPos.tz * 0.8 };
          const lsteps = Math.max(2, Math.ceil(Math.hypot(lungeTo.x - B.x, lungeTo.z - B.z) / 0.25));
          for (let k = 1; k <= lsteps; k++) cTrack!.add(B.x + ((lungeTo.x - B.x) * k) / lsteps, B.z + ((lungeTo.z - B.z) * k) / lsteps);
          crea = "lunge";
          creaT = 0;
          cVis = 1;
          holdUntil = 0;
          cReach = 1;
          cFlail = 1;
          creatureCue(tau, "shriek", 1, 1);
          // It drags you back round its corner and on down that hall.
          const cp = new Trail();
          cp.add(walkerPos.x, walkerPos.z);
          let ci = ni;
          let ck = nk;
          let cdir = side;
          cp.add(B.x, B.z);
          for (let step = 0; step < 7; step++) {
            if (!brOpen(ci, ck, cdir)) {
              const turns = [(cdir + 1) & 3, (cdir + 3) & 3].filter((d) => brOpen(ci, ck, d));
              if (!turns.length) break;
              cdir = turns[Math.floor(R() * turns.length)]!;
            }
            const x0 = ci * BR_GRID;
            const z0 = ck * BR_GRID;
            ci += DX[cdir]!;
            ck += DZ[cdir]!;
            for (let sgm = 1; sgm <= 16; sgm++) cp.add(x0 + DX[cdir]! * sgm * 0.25, z0 + DZ[cdir]! * sgm * 0.25);
          }
          cornerPath = cp;
        }
      }
    }
    if (((walk as Walk) === "approach" || (walk as Walk) === "explore" || (walk as Walk) === "pause" || (walk as Walk) === "stare") && creatureSeen && spotted < 0) {
      spotted = tau;
      // Where the runner stood when it saw it: on the same hall, so the charge line never cuts a pillar.
      spotIdx = Math.max(0, trail.x.length - 1);
      spotPos = { x: walkerPos.x, z: walkerPos.z };
      events.push({ t: t0 + tau + 0.25, id: "gasp", gain: 1, pan: 0 });
      if ((k2 as BrKind) === "ambush") {
        walk = "brake";
        walkT = 0;
      } else if ((walk as Walk) !== "approach" && (walk as Walk) !== "stare") {
        walk = "approach";
        stopU = Math.min(route.end, u + Math.max(0.3, (v * v) / 4));
      }
    }
    if ((walk as Walk) === "approach" && u >= stopU - 0.03 && v < 0.05) {
      walk = "stare";
      walkT = 0;
    }
    // A second or so of frozen disbelief, then run — at once if it charges or gets close.
    const coming = (crea as Crea) === "stepout" || (crea as Crea) === "stare" || (crea as Crea) === "charge";
    if (((walk as Walk) === "stare" || (walk as Walk) === "approach") && spotted >= 0 && coming
      && (tau - spotted > O.freeze || distW < O.runDistance || ((crea as Crea) === "charge" && creaT > 0.3))) {
      startFlee(tau, true);
    }
    if ((walk as Walk) === "stare") {
      const peekGone = ((crea as Crea) === "off" || (crea as Crea) === "withdraw") && spotted >= 0 && walkT > 1.0;
      if (peekGone && walkT > 1.6) startFlee(tau, false);
      else if (spotted < 0 && walkT > 3) {
        walk = "explore";
        stopU = Infinity;
        decideNext(tau, true);
      }
    }
    if ((walk as Walk) === "brake" && v < 0.05 && walkT > 0.35) startFlee(tau, true);
    if (willCatch && (walk as Walk) === "flee" && fleeFast && stumbleAt < 0 && walkT > 1.6) {
      // Trips and goes down; it does not get up again.
      stumbleAt = walkT;
      stumbleUntil = Infinity;
      events.push({ t: t0 + tau, id: "handle", gain: 1, pan: 0 });
      events.push({ t: t0 + tau + 0.1, id: "gasp", gain: 1, pan: 0 });
    }
    if (willCatch && caughtAt < 0 && distW < 1.1 && ((crea as Crea) === "pursue" || (crea as Crea) === "charge" || (crea as Crea) === "lunge")) {
      // Caught: a struggle, the camera goes down, it drags the body away.
      walk = "caught";
      walkT = 0;
      v = 0;
      creatureCue(tau, "shriek", 1, 0.9);
      caughtAt = tau;
      events.push({ t: t0 + tau, id: "yelp", gain: 1, pan: 0 });
      events.push({ t: t0 + tau + 0.35, id: "handle", gain: 1, pan: 0 });
      events.push({ t: t0 + tau + 1.3, id: "drop", gain: 1, pan: 0 });
      Object.assign(dropFrom, lastOut);
      const here = route.sample(u);
      const fx = lastOut.x + here.tx * 0.35;
      const fz = lastOut.z + here.tz * 0.35;
      const clearAhead = brWallDist(fx, fz) > 0.9;
      dropTo.x = clearAhead ? fx : lastOut.x;
      dropTo.z = clearAhead ? fz : lastOut.z;
      let dp = new Trail();
      if (cornerPath) dp = cornerPath;
      else for (let s = trail.x.length - 1; s >= Math.max(0, trail.x.length - 600); s--) dp.add(trail.x[s]!, trail.z[s]!);
      cornerPath = null;
      dragCorners = [];
      for (let k = 2; k < dp.x.length; k++) {
        const a1 = Math.atan2(dp.z[k - 1]! - dp.z[k - 2]!, dp.x[k - 1]! - dp.x[k - 2]!);
        const a2 = Math.atan2(dp.z[k]! - dp.z[k - 1]!, dp.x[k]! - dp.x[k - 1]!);
        if (Math.abs(wrapPi(a2 - a1)) > 0.35) dragCorners.push([dp.s[k - 1]!, dp.x[k - 1]!, dp.z[k - 1]!]);
      }
      dragPath = dp;
      // Start the drag where the creature already stands on that path, so it never cuts a corner getting there.
      let near = 0;
      let nd2 = Infinity;
      for (let k = 0; k < Math.min(dp.x.length, 60); k++) {
        const q2 = (dp.x[k]! - cx) ** 2 + (dp.z[k]! - cz) ** 2;
        if (q2 < nd2) { nd2 = q2; near = k; }
      }
      dragD = Math.max(1.35, dp.s[near] ?? 0);
      const look = dp.at(4);
      dropTo.yaw = yawOf(look.x - dropTo.x, look.z - dropTo.z) + (R() - 0.5) * 0.35;
      dropTo.roll = (R() < 0.5 ? -1 : 1) * (1.35 + R() * 0.2);
      crea = "drag";
      creaT = 0;
      cReach = 0.2;
    }
    // The last chase always ends it: if nothing has come for the runner in time, it comes from behind.
    if (O.endCatch && caughtAt < 0 && !forcedEnd && tau >= dur - 22) {
      forcedEnd = true;
      willCatch = true;
      const chasingNow = (walk as Walk) === "flee" && ((crea as Crea) === "pursue" || (crea as Crea) === "charge");
      if (!chasingNow) {
        finalStarted = true;
        encounterActive = true;
        k2 = "charge";
        const from = Math.max(0, trail.end - 9);
        let si = 0;
        while (si < trail.s.length - 1 && trail.s[si]! < from) si++;
        const tr = new Trail();
        for (let s2 = si; s2 < trail.x.length; s2++) tr.add(trail.x[s2]!, trail.z[s2]!);
        cTrack = tr;
        cd = 0;
        trailFrom = trail.x.length;
        const b0 = trail.at(from);
        cx = b0.x;
        cz = b0.z;
        cVis = 1;
        holdUntil = 0;
        crea = "charge";
        creaT = 0.5;
        cSpeed = spCharge * 0.8;
        creatureCue(tau, "roar", 1, 0.7);
        spotted = tau;
        events.push({ t: t0 + tau + 0.3, id: "gasp", gain: 1, pan: 0 });
        if ((walk as Walk) !== "flee") {
          walk = "flee";
          fleeFast = true;
          walkT = 0;
          glanceAt = -1;
          nextGlance = 0.3;
          glanceStart = -1;
          stopU = Infinity;
          if (u >= route.end - 2.6) decideNext(tau, u >= route.end - 0.05);
        }
      }
    }
    // Over-the-shoulder looks while it chases: see how close it is; freak out and sprint if it is right there.
    const chasing = cVis > 0.5 && ((crea as Crea) === "pursue" || (crea as Crea) === "charge" || (crea as Crea) === "giveup" || (crea as Crea) === "stand");
    const seesIt = chasing && distW < 28 && lineClear(walkerPos.x, walkerPos.z, cx, cz);
    if ((walk as Walk) === "flee" && fleeFast) {
      if (glanceStart < 0 && walkT >= nextGlance) {
        if (chasing && distW < 28 && R() < O.lookBacks) {
          glanceStart = walkT;
          glanceEnd = walkT + 0.75 + R() * 0.3;
          glanceChecked = false;
        }
        nextGlance = walkT + 1.9 + R() * 1.8;
      }
      if (glanceStart >= 0) {
        if (!glanceChecked && walkT >= glanceStart + 0.38) {
          glanceChecked = true;
          if (seesIt && distW < 7.5) {
            events.push({ t: t0 + tau, id: "yelp", gain: 1, pan: 0 });
            events.push({ t: t0 + tau + 0.05, id: "handle", gain: 0.9, pan: 0 });
            freakUntil = walkT + 2.2;
            glanceEnd = walkT + 0.1;
            panic = 1;
          }
        }
        if (walkT > glanceEnd) glanceStart = -1;
      }
    }
    // Keep running until it is out of sight or well behind (and so quiet), not on a timer.
    // Keep running while it can still be heard coming, and until a couple of corners are between you and where it
    // was last seen.
    if ((walk as Walk) === "flee" && seesIt && distW < 20) fleeTurns = 0;
    const hearsIt = cVis > 0.5 && ((crea as Crea) === "pursue" || (crea as Crea) === "charge" || (crea as Crea) === "stepout" || (crea as Crea) === "stare") && distW < 25;
    const farAway = !hearsIt && fleeTurns >= 2 && (cVis < 0.5 || distW > 14);
    safeFor = farAway ? safeFor + dt : 0;
    if ((walk as Walk) === "flee" && !willCatch && ((walkT > 5 && walkT > freakUntil + 1.3 && safeFor > 1.2) || walkT > 30 || tau > dur - 2.5)) {
      walk = "recover";
      walkT = 0;
      glanceStart = -1;
    }
    if ((walk as Walk) === "rest" && caughtAt < 0 && !cornered && walkT > restFor) {
      walk = "explore";
      walkT = 0;
      stopU = Infinity;
      encounterActive = false;
      spotted = -1;
      nextEncounterAt = tau + 8 + R() * 12;
    }
    if ((walk as Walk) === "rest" && cornered && walkT > 6 && (crea as Crea) !== "pursue") {
      cornered = false;
      walkT = 0;
    }
    if ((walk as Walk) === "stare" && spotted < 0 && walkT > 2.9) {
      encounterActive = false;
      nextEncounterAt = tau + 4;
    }
    if ((walk as Walk) === "recover" && walkT > 2.8) {
      walk = "rest";
      walkT = 0;
      restFor = 3 + R() * 1.5;
      lookBackAt = 1.1 + R() * 0.6;
      events.push({ t: t0 + tau, id: "handle", gain: 0.45, pan: 0 });
    }

    // Speed with realistic limits: cautious walk, panicked jog with a camera, hard brakes.
    let vT = 0;
    let accel = 1.2;
    switch (walk as Walk) {
      case "explore": vT = O.walkSpeed * (1 + 0.1 * vnoise(tau * 0.35, noiseSeed + 1)); break;
      case "pause": vT = O.walkSpeed * 0.88; break;
      case "approach": vT = O.walkSpeed * 0.8; accel = 2.2; break;
      case "flee":
        vT = fleeFast ? O.runSpeed * (1 + 0.06 * vnoise(tau * 0.7, noiseSeed + 2)) : Math.min(O.runSpeed, 1.5 * O.walkSpeed);
        if (walkT < freakUntil) vT = O.runSpeed * 1.15;
        if (stumbleAt >= 0) {
          vT = 0;
          accel = 6;
        }
        else if (glanceStart >= 0) vT *= 0.88;
        accel = fleeFast ? 3.4 : 1.6;
        break;
      case "recover": vT = O.walkSpeed * 0.8; accel = 1.6; break;
      case "brake": vT = 0; accel = 5.5; break;
      default: vT = 0; accel = 2.5;
    }
    // Slow for corners and stops so the runner rounds pillars instead of skidding into them.
    const toCorner = route.end - u;
    const c = route.pts.length - 1;
    if (c >= 1 && route.rad[c - 1]! > 0 && u > route.cum[c - 1]! - 1.4 && u < route.cum[c - 1]! + 0.95) vT = Math.min(vT, (walk as Walk) === "flee" ? 3.0 : 0.95);
    if (stopU < Infinity) vT = Math.min(vT, Math.sqrt(2 * 1.8 * Math.max(0, stopU - u)));
    else if (toCorner < 0) vT = 0;
    // Hard rule: never walk toward it once it is this close — freeze instead.
    const toCx = cx - walkerPos.x;
    const toCz = cz - walkerPos.z;
    if (cVis > 0.3 && distW < 5 && walkerPos.tx * toCx + walkerPos.tz * toCz > 0.3 * distW && (walk as Walk) !== "stare") {
      vT = 0;
      accel = Math.max(accel, 4);
    }
    const dv = vT - v;
    v += clamp(dv, -Math.max(accel, 2.5) * dt, accel * dt);
    v = Math.max(0, v);
    u += v * dt;
    if (stopU < Infinity) u = Math.min(u, stopU);
    u = Math.min(u, route.end);
    const pos = route.sample(u);
    trail.add(pos.x, pos.z);

    // Gait phase and footsteps.
    const stepLen = 0.62 + 0.17 * v;
    const prevPhi = phi;
    phi += (v * dt / stepLen) * Math.PI;
    if (v > 0.25 && Math.floor(phi / Math.PI) > Math.floor(prevPhi / Math.PI)) {
      const running = v > 2.2;
      events.push({ t: t0 + tau, id: running ? "run" : "step", gain: clamp(0.35 + v * 0.18, 0.3, 1), pan: Math.floor(phi / Math.PI) % 2 ? 0.15 : -0.15 });
    }

    // Panic and exertion.
    const panicT = (walk as Walk) === "stare" || (walk as Walk) === "brake" ? ((crea as Crea) === "charge" ? 1 : 0.8)
      : (walk as Walk) === "flee" ? 1 : (walk as Walk) === "approach" && spotted >= 0 ? 0.75 : (walk as Walk) === "recover" || (walk as Walk) === "rest" ? 0.35 : 0.05;
    panic += (panicT - panic) * clamp(dt * (panicT > panic ? 3 : 0.18), 0, 1);
    exert = clamp(exert + dt * (v > 2 ? 0.16 * (v / 3.6) ** 2 : -0.05), 0, 1);

    // ----- camera: a camcorder carried by someone, not a floating head
    const ahead = route.sample(Math.min(route.end, u + ((walk as Walk) === "flee" ? 2.2 : 1.7)));
    let lookYaw = Math.hypot(ahead.x - pos.x, ahead.z - pos.z) > 0.2 ? yawOf(ahead.x - pos.x, ahead.z - pos.z) : yawOf(pos.tx, pos.tz);
    let lookPitch = -0.035;
    let omega = 4.2;
    let glanceTilt = 0;
    const toCrYaw = yawOf(cx - pos.x, cz - pos.z);
    if ((walk as Walk) === "pause" && pauseUntil > 0) {
      const base = yawOf(DX[dir]!, DZ[dir]!);
      const k = clamp(walkT / (pauseSides.length ? 2.2 : 0.9), 0, 1);
      if (pauseSides.length) {
        const first = yawOf(DX[pauseSides[0]!]!, DZ[pauseSides[0]!]!);
        const second = pauseSides[1] !== undefined ? yawOf(DX[pauseSides[1]!]!, DZ[pauseSides[1]!]!) : base;
        lookYaw = k < 0.45 ? base + wrapPi(first - base) * 0.85 : base + wrapPi(second - base) * 0.85;
      } else lookYaw = base;
      omega = 3.2;
    } else if (((walk as Walk) === "approach" && spotted >= 0) || (walk as Walk) === "stare" || (walk as Walk) === "brake") {
      lookYaw = toCrYaw;
      const headY = 1.9 + 0.35 * (1 - cHunch);
      lookPitch = clamp(Math.atan2(headY - camH, Math.max(0.5, distW)), -0.1, 0.3) * 0.8;
      omega = 7.5;
    } else if ((walk as Walk) === "flee" && stumbleAt >= 0) {
      lookYaw = toCrYaw;
      lookPitch = 0.12;
      omega = 8;
    } else if ((walk as Walk) === "flee" && glanceStart >= 0) {
      const back = trail.at(Math.max(0, trail.end - 5));
      const target = seesIt ? toCrYaw : yawOf(back.x - pos.x, back.z - pos.z);
      glanceTilt = Math.sign(wrapPi(target - lookYaw)) || 1;
      lookYaw = target;
      lookPitch = -0.06;
      omega = 11;
    } else if ((walk as Walk) === "flee") {
      if (walkT > glanceAt && walkT < glanceAt + 0.85) {
        lookYaw = cVis > 0.3 ? toCrYaw : lookYaw + Math.PI * 0.9;
        omega = 9;
      } else omega = 7;
      lookPitch = -0.07;
    } else if ((walk as Walk) === "rest") {
      lookPitch = -0.2;
      omega = 3.5;
      if (walkT > lookBackAt && walkT < lookBackAt + 1.3) {
        const back = trail.at(Math.max(0, trail.end - 6));
        lookYaw = yawOf(back.x - pos.x, back.z - pos.z);
        lookPitch = -0.05;
        omega = 6;
      }
    } else if ((walk as Walk) === "recover") {
      lookPitch = -0.1;
    }
    const scan = (walk as Walk) === "explore" ? 0.07 * vnoise(tau * 0.45, noiseSeed + 3) : 0;
    const tgtYaw = yaw + wrapPi(lookYaw + scan - yaw);
    const zeta = 0.72;
    yawVel += (omega * omega * (tgtYaw - yaw) - 2 * zeta * omega * yawVel) * dt;
    yaw += yawVel * dt;
    const oP = 5.5;
    pitchVel += (oP * oP * (lookPitch - pitch) - 2 * zeta * oP * pitchVel) * dt;
    pitch += pitchVel * dt;
    const turnRate = (yaw - prevYaw) / dt;
    prevYaw = yaw;
    const running = clamp((v - 1.3) / 2.2, 0, 1);
    const rollT = clamp(-0.07 * turnRate * (0.3 + running), -0.14, 0.14) + 0.02 * vnoise(tau * 0.3, noiseSeed + 4) + ((walk as Walk) === "rest" ? 0.05 : 0) + 0.13 * glanceTilt;
    const oR = 6;
    rollVel += (oR * oR * (rollT - roll) - 2 * 0.6 * oR * rollVel) * dt;
    roll += rollVel * dt;
    const down = (walk as Walk) === "flee" && stumbleAt >= 0;
    const hT = down ? 0.55 : (walk as Walk) === "rest" ? 1.28 : (walk as Walk) === "flee" ? 1.42 : (walk as Walk) === "stare" ? 1.46 : 1.5;
    camH += (hT - camH) * clamp(dt * (down ? 5 : 2.5), 0, 1);

    // Step bob, weight shift, and hand shake (breathing tremor when frozen).
    const bobA = (0.016 + 0.034 * running) * O.handheld;
    const swayA = (0.014 + 0.022 * running) * O.handheld;
    const moving = clamp(v / 0.6, 0, 1);
    const bob = bobA * (Math.abs(Math.sin(phi)) - 0.63) * moving;
    const sway = swayA * Math.sin(phi) * moving;
    const shakeA = 0.004 + 0.016 * running + ((walk as Walk) === "stare" ? 0.004 * panic : 0) + ((walk as Walk) === "rest" ? 0.005 : 0) + (walkT < freakUntil ? 0.012 : 0) + (glanceStart >= 0 ? 0.008 : 0);
    const shakeYaw = O.handheld * shakeA * (vnoise(tau * 3.1, noiseSeed + 11) + 0.4 * vnoise(tau * 9.7, noiseSeed + 12));
    const shakePitch = O.handheld * shakeA * (vnoise(tau * 2.7, noiseSeed + 13) + 0.4 * vnoise(tau * 8.3, noiseSeed + 14)) + 0.012 * running * Math.cos(2 * phi);
    const tremor = (walk as Walk) === "stare" || (walk as Walk) === "brake" ? 0.0022 * panic * Math.sin(tau * 57) : 0;
    const breathe = ((walk as Walk) === "rest" ? 0.018 : 0.004) * Math.sin(tau * ((walk as Walk) === "rest" ? 4.2 : 1.6));
    const perpX = -pos.tz;
    const perpZ = pos.tx;
    const camX = pos.x + perpX * sway;
    const camZ = pos.z + perpZ * sway;

    if (bodyVis > 0 && dragPath) {
      const bp = dragPath.at(Math.max(0, dragD - 1.3));
      const feet = dragPath.at(Math.max(0, dragD - 0.4));
      bodyX = bp.x;
      bodyZ = bp.z;
      bodyYaw = yawOf(feet.x - bp.x, feet.z - bp.z);
    }

    // ----- visuals + sound levels
    const near = cVis * clamp((11 - distW) / 8, 0, 1);
    const hush = Math.max(near, spotted >= 0 && ((walk as Walk) === "stare" || (walk as Walk) === "brake") ? 0.4 : 0);
    const cut = clamp(1 - (tau - tapeStartAt) / 0.45, 0, 1);
    const glitch = clamp(0.04 + near * 0.85 + cut * 0.6 + ((walk as Walk) === "flee" ? 0.1 : 0) + ((walk as Walk) === "flee" && walkT < freakUntil ? 0.3 : 0), 0, 1);

    if (O.musicBox && boxAt < 0 && !encounterActive && tau > 4 + (e % 7) && tau < finalAt - 20) {
      boxAt = tau;
      if (brHash(e, 3, 41) > 0.45) events.push({ t: t0 + tau, id: "box", gain: 0.9, pan: 0 });
    }
    if ((k2 as BrKind) === "peek" && (crea as Crea) === "lurk" && creaT > 0.5 && creaT - dt <= 0.5 && R() < 0.5) {
      creatureCue(tau, "hoo", 0.8);
    }

    let out = {
      x: camX,
      y: camH + bob + breathe,
      z: camZ,
      yaw: yaw + shakeYaw,
      pitch: pitch + shakePitch + tremor + breathe * 0.6,
      roll: roll + 0.5 * shakeYaw + 0.018 * Math.sin(phi) * moving,
    };
    if (caughtAt >= 0) {
      const a = tau - caughtAt;
      if (a < 0.9) {
        // The struggle: the camera wrenches round to it, thrashing.
        const toC = yawOf(cx - dropFrom.x, cz - dropFrom.z);
        const k = clamp(a / 0.3, 0, 1);
        out = {
          x: dropFrom.x,
          y: dropFrom.y - 0.3 * (a / 0.9),
          z: dropFrom.z,
          yaw: dropFrom.yaw + wrapPi(toC - dropFrom.yaw) * k + 0.2 * vnoise(a * 14, noiseSeed + 21),
          pitch: 0.12 * k + 0.16 * vnoise(a * 12, noiseSeed + 22),
          roll: 0.4 * vnoise(a * 11, noiseSeed + 23),
        };
        Object.assign(struggleEnd, out);
      } else {
        // The camcorder hits the carpet and lies on its side, still recording.
        const k = clamp((a - 0.9) / 0.55, 0, 1);
        const sk = k * k * (3 - 2 * k);
        const land = a - 1.45;
        const bounce = land > 0 ? 0.05 * Math.exp(-land * 7) * Math.abs(Math.sin(land * 16)) : 0;
        out = {
          x: struggleEnd.x + (dropTo.x - struggleEnd.x) * sk,
          y: struggleEnd.y + (0.12 - struggleEnd.y) * k * k + bounce,
          z: struggleEnd.z + (dropTo.z - struggleEnd.z) * sk,
          yaw: struggleEnd.yaw + wrapPi(dropTo.yaw - struggleEnd.yaw) * sk,
          pitch: struggleEnd.pitch + (0.05 - struggleEnd.pitch) * sk,
          roll: struggleEnd.roll + (dropTo.roll - struggleEnd.roll) * sk,
        };
      }
    }
    Object.assign(lastOut, out);
    const o = i * STRIDE;
    f[o + BR_SLOT.mark] = 1;
    f[o + BR_SLOT.camX] = out.x;
    f[o + BR_SLOT.camY] = out.y;
    f[o + BR_SLOT.camZ] = out.z;
    f[o + BR_SLOT.yaw] = out.yaw;
    f[o + BR_SLOT.pitch] = out.pitch;
    f[o + BR_SLOT.roll] = out.roll;
    f[o + BR_SLOT.zoom] = 1;
    // Read the held pose here, after the runner brain: a spawn this step must not show the old spot.
    f[o + BR_SLOT.crX] = tau < holdUntil ? held.x : cx;
    f[o + BR_SLOT.crZ] = tau < holdUntil ? held.z : cz;
    f[o + BR_SLOT.crFace] = cFace;
    f[o + BR_SLOT.crGait] = tau < holdUntil ? held.gait : cGait;
    f[o + BR_SLOT.crVis] = cVis;
    f[o + BR_SLOT.crHunch] = cHunch;
    f[o + BR_SLOT.crReach] = cReach;
    f[o + BR_SLOT.crLean] = cLean;
    f[o + BR_SLOT.crHeadYaw] = cHeadYaw;
    f[o + BR_SLOT.crHeadRoll] = cHeadRoll;
    f[o + BR_SLOT.crFlail] = cFlail;
    f[o + BR_SLOT.crClock] = tau < holdUntil ? held.clock : cClock;
    f[o + BR_SLOT.hush] = hush;
    f[o + BR_SLOT.glitch] = glitch;
    f[o + BR_SLOT.cut] = cut;
    f[o + BR_SLOT.exposure] = 1 + 0.06 * vnoise(tau * 0.25, noiseSeed + 6) - 0.06 * near;
    f[o + BR_SLOT.winI] = Math.round(camX / BR_GRID) - BR_WIN / 2;
    f[o + BR_SLOT.winK] = Math.round(camZ / BR_GRID) - BR_WIN / 2;
    f[o + BR_SLOT.tau] = tau;
    f[o + BR_SLOT.panic] = panic;
    f[o + BR_SLOT.crSpeed] = tau < holdUntil ? held.speed : cMove;
    f[o + BR_SLOT.crType] = BR_CREATURES.indexOf(creature);
    f[o + BR_SLOT0_FLOATS + SFX.kind] = KINDS.indexOf(k2);
    f[o + BR_SLOT.bodyVis] = bodyVis;
    if (caughtAt >= 0 && dragPath && bodyVis > 0) {
      // Blood from where it happened, along the path actually dragged, to under the body.
      const sEnd = Math.max(0.05, dragD - 1.3);
      const pts: number[][] = [[dragPath.x[0]!, dragPath.z[0]!]];
      for (const c of dragCorners) if (c[0]! < sEnd && pts.length < BR_TRAIL_POINTS - 1) pts.push([c[1]!, c[2]!]);
      const tip = dragPath.at(sEnd);
      pts.push([tip.x, tip.z]);
      for (let k = 0; k < pts.length; k++) {
        f[o + BR_SLOT.trail0 + 2 * k] = pts[k]![0]!;
        f[o + BR_SLOT.trail0 + 2 * k + 1] = pts[k]![1]!;
      }
      f[o + BR_SLOT.trailN] = pts.length;
    }
    f[o + BR_SLOT.bodyX] = bodyX;
    f[o + BR_SLOT.bodyZ] = bodyZ;
    f[o + BR_SLOT.bodyYaw] = bodyYaw;
    if (caughtAt >= 0) {
      // The creature and the breathing go silent; later the signal breaks up.
      const after = tau - caughtAt;
      f[o + BR_SLOT.cut] = Math.max(cut, clamp((after - 10.5) / 1.2, 0, 1));
      f[o + BR_SLOT.glitch] = clamp(glitch + (after < 1.6 ? 0.6 : 0), 0, 1);
      f[o + BR_SLOT.hush] = 0;
    }
    const s = o + BR_SLOT0_FLOATS;
    f[s + SFX.buzz] = 1 - 0.75 * hush;
    f[s + SFX.box] = boxAt >= 0 && tau < boxAt + 7 ? 1 - near : 0;
    f[s + SFX.frozen] = ((walk as Walk) === "stare" || (walk as Walk) === "approach" || (walk as Walk) === "brake") && spotted >= 0 ? panic : 0;
    f[s + SFX.pant] = clamp(v / 3.6, 0, 1) * (0.55 + 0.45 * exert) * ((walk as Walk) === "flee" ? 1 : 0.6);
    f[s + SFX.heavy] = clamp(exert * 1.3, 0, 1) * (1 - clamp(v / 3.6, 0, 1)) * ((walk as Walk) === "recover" || (walk as Walk) === "rest" ? 1 : 0.3);
    f[s + SFX.heart] = clamp((panic - 0.25) / 0.75, 0, 1);
    f[s + SFX.heartRate] = 1 + 0.6 * panic;
    f[s + SFX.near] = near;
    if (caughtAt >= 0) {
      f[s + SFX.frozen] = 0;
      f[s + SFX.pant] = 0;
      f[s + SFX.heavy] = 0;
      f[s + SFX.heart] = 0;
      f[s + SFX.near] = 0;
      f[s + SFX.buzz] = 1;
    }
  }
  events.sort((a, b) => a.t - b.t);
  const endPos = route.sample(u);
  return {
    e, t0, dur, kind: k2, creature: firstCreature, n, f, events,
    endCaught: caughtAt >= 0,
    end: { x: endPos.x, z: endPos.z, li, lk, dir, yaw, camH, phi },
  };
}

const cache = new Map<number, Track>();

/** Without the end catch, up to ten episodes run on as one unbroken walk. */
const CHAIN = 10;

function trackFor(e: number, t0: number, dur: number): Track {
  let tr = cache.get(e);
  if (!tr) {
    let start: StartState | null = null;
    if (e > 0 && e % CHAIN !== 0) {
      const prev = trackFor(e - 1, t0 - dur, dur);
      if (!prev.endCaught) start = prev.end;
    }
    tr = simulate(e, t0, dur, start);
    cache.set(e, tr);
    if (cache.size > 3) cache.delete(cache.keys().next().value as number);
  }
  return tr;
}

function trackAt(t: number): Track {
  const ep = brEpisodeAt(t);
  return trackFor(ep.e, ep.t0, ep.dur);
}

/** Director state at sky time `t`. */
export function backroomsFrame(t: number): BrFrame {
  const tr = trackAt(t);
  const tau = clamp(t - tr.t0, 0, tr.dur);
  const x = tau * HZ;
  const i = Math.min(tr.n - 2, Math.floor(x));
  const w = clamp(x - i, 0, 1);
  const a = i * STRIDE;
  const b = (i + 1) * STRIDE;
  // A new tape starts somewhere else: snap to the nearer sample instead of blending across the jump.
  const jump = Math.hypot(tr.f[b + BR_SLOT.camX]! - tr.f[a + BR_SLOT.camX]!, tr.f[b + BR_SLOT.camZ]! - tr.f[a + BR_SLOT.camZ]!) > 2;
  const wk = jump ? (w < 0.5 ? 0 : 1) : w;
  const lerp = (k: number): number => tr.f[a + k]! + (tr.f[b + k]! - tr.f[a + k]!) * wk;
  const slot0: number[] = [];
  for (let k = 0; k < BR_SLOT0_FLOATS; k++) slot0.push(lerp(k));
  // Integer fields come from the nearest sample, not a blend.
  slot0[BR_SLOT.winI] = tr.f[a + BR_SLOT.winI]!;
  slot0[BR_SLOT.winK] = tr.f[a + BR_SLOT.winK]!;
  for (let k = BR_SLOT.trail0; k <= BR_SLOT.trailN; k++) slot0[k] = tr.f[a + k]!;
  // Never blend the creature across a reveal or a vanish (its hidden position is stale).
  const va = tr.f[a + BR_SLOT.crVis]!;
  const vb = tr.f[b + BR_SLOT.crVis]!;
  if ((va < 0.01) !== (vb < 0.01)) {
    const src = vb >= 0.01 ? b : a;
    for (const k of [BR_SLOT.crX, BR_SLOT.crZ, BR_SLOT.crFace, BR_SLOT.crGait, BR_SLOT.crClock]) slot0[k] = tr.f[src + k]!;
  }
  const s = BR_SLOT0_FLOATS;
  return {
    episode: tr.e,
    kind: KINDS[Math.round(tr.f[a + s + SFX.kind]!)] ?? tr.kind,
    creature: BR_CREATURES[Math.round(tr.f[a + BR_SLOT.crType]!)] ?? tr.creature,
    tau,
    dur: tr.dur,
    slot0,
    sfx: {
      buzz: lerp(s + SFX.buzz),
      box: lerp(s + SFX.box),
      frozen: lerp(s + SFX.frozen),
      pant: lerp(s + SFX.pant),
      heavy: lerp(s + SFX.heavy),
      heart: lerp(s + SFX.heart),
      heartRate: lerp(s + SFX.heartRate),
      near: lerp(s + SFX.near),
    },
  };
}

/** One-shot sound cues in (t0, t1]; spans at most two episodes. */
export function backroomsEvents(t0: number, t1: number): BrEvent[] {
  if (!(t1 > t0)) return [];
  const from = Math.max(t0, t1 - 0.5);
  const out: BrEvent[] = [];
  const seen = new Set<number>();
  for (const t of [from, t1]) {
    const tr = trackAt(t);
    if (seen.has(tr.e)) continue;
    seen.add(tr.e);
    for (const ev of tr.events) if (ev.t > from && ev.t <= t1) out.push(ev);
  }
  return out.sort((a, b) => a.t - b.t);
}

let lastWin = "";
let lastWinData: number[] = [];

/**
 * Slot 0 (camera, creature, fx, camcorder OSD) and slot 1 (walled edges around the camera) for the sky.
 * `clock` is the wall time stamped on the tape; `aspect` places the OSD at the frame edges.
 */
export function backroomsSlots(t: number, clock = new Date(), aspect = 16 / 9): { frame: BrFrame; slot0: number[]; slot1: number[] } {
  const frame = backroomsFrame(t);
  frame.slot0[BR_SLOT.year] = clock.getFullYear();
  frame.slot0[BR_SLOT.month] = clock.getMonth() + 1;
  frame.slot0[BR_SLOT.day] = clock.getDate();
  frame.slot0[BR_SLOT.secOfDay] = clock.getHours() * 3600 + clock.getMinutes() * 60 + clock.getSeconds();
  frame.slot0[BR_SLOT.aspect] = aspect;
  // One battery lasts 25 minutes of footage, then a fresh one goes in.
  frame.slot0[BR_SLOT.battery] = 1 - 0.95 * ((Math.max(0, t) / 1500) % 1);
  frame.slot0[BR_SLOT.optOsd] = opts.osd ? 1 : 0;
  frame.slot0[BR_SLOT.optVhs] = opts.vhs;
  frame.slot0[BR_SLOT.optWriting] = opts.writing;
  frame.slot0[BR_SLOT.optObjects] = opts.objects;
  frame.slot0[BR_SLOT.optDarkness] = opts.darkness;
  frame.slot0[BR_SLOT.optShadows] = opts.shadows ? 1 : 0;
  const oi = frame.slot0[BR_SLOT.winI]!;
  const ok = frame.slot0[BR_SLOT.winK]!;
  const key = `${oi},${ok}`;
  if (key !== lastWin) {
    lastWin = key;
    lastWinData = brMazeWindow(oi, ok);
  }
  return { frame, slot0: frame.slot0, slot1: lastWinData };
}
