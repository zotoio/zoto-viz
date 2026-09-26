/**
 * Aquarium viz pack — talker fish, packet bubbles, SYS murk on failure.
 * Procedural only; no bundled assets.
 */

export type WaterKind = "fresh" | "reef";
export type PresetId =
  | "planted"
  | "reef_lagoon"
  | "cichlid_rock"
  | "calm_zen"
  | "night_reef";

export type LightingMode = "daylight" | "actinic" | "moonlight";
export type CameraMode = "front" | "drift" | "hold";

export interface AquariumOptions {
  preset: PresetId;
  water: WaterKind;
  fishCount: number;
  temperament: number;
  feedingMin: number;
  feedingTraffic: boolean;
  lighting: LightingMode;
  dayNight: boolean;
  density: number;
  bubbles: boolean;
  camera: CameraMode;
  seed: number;
  label: boolean;
  freshSpecies: number[];
  reefSpecies: number[];
}

export const FAIL_MURK_THRESHOLD = 0.35;
export const PACKET_FRAME_CAP = 8;
export const MAX_FISH = 16;
export const MAX_PARTICLES = 16;
export const PARTICLE_STRIDE = 4;

export const PRESET_IDS: PresetId[] = [
  "planted",
  "reef_lagoon",
  "cichlid_rock",
  "calm_zen",
  "night_reef",
];

const FRESH_SPECIES = ["neon", "angel", "guppy", "cory", "discus", "cichlid"] as const;
const REEF_SPECIES = ["clown", "tang", "damsel", "goby", "wrasse", "anemone"] as const;

export const PRESET_CAPS: Record<PresetId, { maxFish: number; maxParticles: number }> = {
  planted: { maxFish: 14, maxParticles: 12 },
  reef_lagoon: { maxFish: 12, maxParticles: 14 },
  cichlid_rock: { maxFish: 10, maxParticles: 10 },
  calm_zen: { maxFish: 8, maxParticles: 8 },
  night_reef: { maxFish: 12, maxParticles: 16 },
};

export const AQU_SLOT = {
  water: 0,
  lighting: 1,
  dayPhase: 2,
  temperament: 3,
  density: 4,
  murk: 5,
  failBanner: 6,
  bubbles: 7,
  camera: 8,
  camPhase: 9,
  feeding: 10,
  feedY: 11,
  canvasW: 12,
  canvasH: 13,
  labelOn: 14,
  presetNorm: 15,
  seedFrac: 16,
  fishCount: 17,
  particleCount: 18,
  demo: 19,
  trafficBurst: 20,
} as const;

export const DEFAULT_OPTIONS: AquariumOptions = {
  preset: "planted",
  water: "fresh",
  fishCount: 12,
  temperament: 0.35,
  feedingMin: 0,
  feedingTraffic: true,
  lighting: "daylight",
  dayNight: true,
  density: 0.72,
  bubbles: true,
  camera: "drift",
  seed: 4242,
  label: true,
  freshSpecies: [1, 1, 1, 1, 1, 0],
  reefSpecies: [0, 0, 0, 0, 0, 0],
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

function parseBool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === "") return d;
  return v === "true" || v === "1";
}

function parseNum(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function parseSpeciesFlags(
  cfg: Record<string, string> | undefined,
  prefix: string,
  names: readonly string[],
  defaults: number[],
): number[] {
  return names.map((name, i) => {
    const key = `${prefix}_${name}`;
    if (cfg?.[key] === undefined) return defaults[i] ?? 1;
    return parseBool(cfg[key], defaults[i] !== 0) ? 1 : 0;
  });
}

function presetDefaults(preset: PresetId): Partial<AquariumOptions> {
  switch (preset) {
    case "planted":
      return {
        water: "fresh",
        fishCount: 14,
        temperament: 0.28,
        density: 0.85,
        lighting: "daylight",
        freshSpecies: [1, 1, 1, 1, 1, 0],
      };
    case "reef_lagoon":
      return {
        water: "reef",
        fishCount: 12,
        temperament: 0.4,
        density: 0.8,
        lighting: "actinic",
        reefSpecies: [1, 1, 1, 1, 1, 1],
      };
    case "cichlid_rock":
      return {
        water: "fresh",
        fishCount: 10,
        temperament: 0.82,
        density: 0.45,
        lighting: "daylight",
        freshSpecies: [0, 0, 0, 0, 0, 1],
      };
    case "calm_zen":
      return {
        water: "fresh",
        fishCount: 8,
        temperament: 0.08,
        density: 0.55,
        lighting: "moonlight",
        freshSpecies: [1, 1, 0, 1, 1, 0],
      };
    case "night_reef":
      return {
        water: "reef",
        fishCount: 12,
        temperament: 0.22,
        density: 0.7,
        lighting: "moonlight",
        dayNight: true,
        reefSpecies: [1, 0, 1, 1, 0, 1],
      };
    default:
      return {};
  }
}

export function parseAquariumOptions(cfg?: Record<string, string> | null): AquariumOptions {
  const presetRaw = (cfg?.preset ?? DEFAULT_OPTIONS.preset) as PresetId;
  const preset = PRESET_IDS.includes(presetRaw) ? presetRaw : DEFAULT_OPTIONS.preset;
  const base = { ...DEFAULT_OPTIONS, ...presetDefaults(preset) };
  const cap = PRESET_CAPS[preset].maxFish;
  const waterRaw = cfg?.water ?? base.water;
  const water: WaterKind = waterRaw === "reef" ? "reef" : "fresh";
  const lightingRaw = cfg?.lighting ?? base.lighting;
  const lighting: LightingMode =
    lightingRaw === "actinic" || lightingRaw === "moonlight" ? lightingRaw : "daylight";
  const cameraRaw = cfg?.camera ?? base.camera;
  const camera: CameraMode =
    cameraRaw === "front" || cameraRaw === "hold" ? cameraRaw : "drift";
  return {
    preset,
    water,
    fishCount: Math.round(clamp(parseNum(cfg?.fishCount, base.fishCount), 2, cap)),
    temperament: clamp01(parseNum(cfg?.temperament, base.temperament ?? 0.35)),
    feedingMin: clamp(parseNum(cfg?.feedingMin, base.feedingMin), 0, 120),
    feedingTraffic: parseBool(cfg?.feedingTraffic, base.feedingTraffic),
    lighting,
    dayNight: parseBool(cfg?.dayNight, base.dayNight ?? true),
    density: clamp01(parseNum(cfg?.density, base.density ?? 0.7)),
    bubbles: parseBool(cfg?.bubbles, base.bubbles ?? true),
    camera,
    seed: Math.round(clamp(parseNum(cfg?.seed, base.seed), 0, 99999)),
    label: parseBool(cfg?.label, base.label ?? true),
    freshSpecies: parseSpeciesFlags(cfg ?? undefined, "sp", FRESH_SPECIES, base.freshSpecies ?? DEFAULT_OPTIONS.freshSpecies),
    reefSpecies: parseSpeciesFlags(cfg ?? undefined, "sp", REEF_SPECIES, base.reefSpecies ?? DEFAULT_OPTIONS.reefSpecies),
  };
}

export function presetLabel(preset: PresetId): string {
  const labels: Record<PresetId, string> = {
    planted: "Planted Community",
    reef_lagoon: "Reef Lagoon",
    cichlid_rock: "Cichlid Rock",
    calm_zen: "Calm Zen",
    night_reef: "Night Reef",
  };
  return labels[preset];
}

export function aquariumHudLabel(opts: AquariumOptions, demo: boolean): string {
  const tail = demo ? "demo" : "live";
  return `aquarium · ${presetLabel(opts.preset)} · ${tail}`;
}

export function packNameCheck(): { id: string; name: string; view: string } {
  return { id: "aquarium", name: "Aquarium", view: "plugin:aquarium" };
}

function enabledSpeciesIndices(opts: AquariumOptions): number[] {
  const flags = opts.water === "reef" ? opts.reefSpecies : opts.freshSpecies;
  const out: number[] = [];
  for (let i = 0; i < flags.length; i++) if (flags[i]) out.push(i);
  if (!out.length) out.push(0);
  return out;
}

export function speciesForTalker(
  id: string,
  role: string,
  opts: AquariumOptions,
): number {
  const enabled = enabledSpeciesIndices(opts);
  const h = idHash(id);
  if (role === "gateway") {
    if (opts.water === "reef") return enabled.includes(1) ? 1 : enabled[0]!;
    return enabled.includes(4) ? 4 : enabled[0]!;
  }
  if (role === "internet") return enabled[Math.min(1, enabled.length - 1)]!;
  if (role === "lan") return enabled[0]!;
  return enabled[Math.floor(h * enabled.length) % enabled.length]!;
}

export function vigorFromRate(rate: number): number {
  return clamp01(rate / 220);
}

export interface TalkerRow {
  id: string;
  rate: number;
  role: string;
}

export interface PacketRow {
  proto?: string;
  size?: number;
  field?: number;
}

export interface SysRow {
  failed?: number;
}

export interface VizAquariumFrame {
  t: number;
  dt: number;
  audio: number;
  talkers: TalkerRow[];
  packets: PacketRow[];
  sys?: SysRow;
  demo?: boolean;
}

interface FishBody {
  id: string;
  species: number;
  vigor: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
}

interface ParticleBody {
  x: number;
  y: number;
  z: number;
  kind: number;
  life: number;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AquariumSim {
  private readonly fish = new Map<string, FishBody>();
  private readonly particles: ParticleBody[] = [];
  private feedTimer = 0;
  private feedActive = 0;
  private feedY = 0.85;
  private camPhase = 0;
  private packetCursor = 0;
  /** Packets consumed on the last step (bounded by {@link PACKET_FRAME_CAP}). */
  lastPacketIngest = 0;
  private readonly rng: () => number;
  private opts: AquariumOptions;
  readonly slot0 = new Float32Array(64);
  readonly slot1 = new Float32Array(64);
  readonly slot2 = new Float32Array(64);
  readonly particleScratch = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  private warmed = false;

  constructor(opts: AquariumOptions = DEFAULT_OPTIONS) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: -2, z: 0, kind: 0, life: 0 });
    }
  }

  setOptions(opts: AquariumOptions): void {
    this.opts = opts;
  }

  getOptions(): AquariumOptions {
    return this.opts;
  }

  fishSpeciesById(): Map<string, number> {
    const m = new Map<string, number>();
    for (const f of this.fish.values()) m.set(f.id, f.species);
    return m;
  }

  teardown(): void {
    this.fish.clear();
    this.feedTimer = 0;
    this.feedActive = 0;
    this.packetCursor = 0;
    for (const p of this.particles) {
      p.life = 0;
      p.y = -2;
    }
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  private syncFish(talkers: TalkerRow[]): void {
    const cap = Math.min(this.opts.fishCount, PRESET_CAPS[this.opts.preset].maxFish, MAX_FISH);
    const rows = talkers.slice(0, cap);
    const seen = new Set<string>();
    for (const t of rows) {
      seen.add(t.id);
      let f = this.fish.get(t.id);
      const species = speciesForTalker(t.id, t.role, this.opts);
      const vigor = vigorFromRate(t.rate);
      if (!f) {
        const h = idHash(t.id);
        f = {
          id: t.id,
          species,
          vigor,
          x: (h - 0.5) * 1.2,
          y: 0.1 + (h * 0.7) % 0.35,
          z: ((h * 3.1) % 1 - 0.5) * 1.4,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: h * 6.28,
        };
        this.fish.set(t.id, f);
      } else {
        f.species = species;
        f.vigor = vigor;
      }
    }
    for (const id of [...this.fish.keys()]) {
      if (!seen.has(id)) this.fish.delete(id);
    }
  }

  private spawnDemoFish(t: number): TalkerRow[] {
    const n = Math.min(this.opts.fishCount, 6);
    const out: TalkerRow[] = [];
    for (let i = 0; i < n; i++) {
      const roles = ["gateway", "lan", "internet", "lan", "internet", "lan"];
      out.push({
        id: `demo:${i}:${this.opts.seed}`,
        rate: 60 + 30 * Math.sin(t * 0.4 + i),
        role: roles[i % roles.length]!,
      });
    }
    return out;
  }

  private ingestPackets(packets: PacketRow[]): void {
    const cap = PRESET_CAPS[this.opts.preset].maxParticles;
    let n = 0;
    this.lastPacketIngest = 0;
    const start = this.packetCursor;
    for (let i = 0; i < packets.length && n < PACKET_FRAME_CAP; i++) {
      const idx = (start + i) % packets.length;
      const p = packets[idx]!;
      const slot = this.particles.find((q) => q.life <= 0);
      if (!slot) break;
      const h = idHash(p.proto ?? "ip");
      slot.x = (h - 0.5) * 1.5;
      slot.y = -0.6 + (p.size ?? 64) / 2000;
      slot.z = (idHash((p.proto ?? "") + "z") - 0.5) * 1.2;
      slot.kind = clamp01((p.size ?? 0) / 1500) * 0.7 + h * 0.3;
      slot.life = 2.5 + (p.field ?? 0.3);
      n++;
      this.lastPacketIngest++;
    }
    this.packetCursor = (start + n) % Math.max(1, packets.length);
    let active = 0;
    for (const p of this.particles) if (p.life > 0) active++;
    while (active > cap) {
      let oldest: ParticleBody | null = null;
      for (const p of this.particles) {
        if (p.life <= 0) continue;
        if (!oldest || p.life < oldest.life) oldest = p;
      }
      if (!oldest) break;
      oldest.life = 0;
      active--;
    }
  }

  private maybeFeed(frame: VizAquariumFrame): void {
    const dt = Math.min(0.05, frame.dt || 1 / 60);
    if (this.opts.feedingMin > 0) {
      this.feedTimer += dt;
      if (this.feedTimer >= this.opts.feedingMin * 60) {
        this.feedTimer = 0;
        this.feedActive = 9;
        this.feedY = 0.82;
      }
    }
    if (this.opts.feedingTraffic && frame.packets.length >= 3) {
      const burst = frame.packets.reduce((s, p) => s + (p.field ?? 0), 0) / frame.packets.length;
      if (burst > 0.55) this.feedActive = Math.max(this.feedActive, 5);
    }
    if (this.feedActive > 0) {
      this.feedActive -= dt;
      this.feedY -= dt * 0.06;
    }
  }

  private stepFish(frame: VizAquariumFrame, talkers: TalkerRow[]): void {
    const dt = Math.min(0.05, frame.dt || 1 / 60);
    const calm = 1 - this.opts.temperament;
    const school = 0.35 + calm * 0.45;
    const chase = this.opts.temperament * 0.9;
    const feedPt = this.feedActive > 0 ? { x: 0, y: this.feedY, z: 0.2 } : null;
    for (const f of this.fish.values()) {
      const talker = talkers.find((t) => t.id === f.id);
      const vigor = talker ? vigorFromRate(talker.rate) : f.vigor;
      f.vigor = vigor;
      const wobble = Math.sin(frame.t * (1.2 + vigor) + idHash(f.id) * 9) * 0.15 * school;
      let tx = Math.sin(frame.t * 0.25 + idHash(f.id) * 4) * (0.55 + calm * 0.25);
      let ty = 0.05 + vigor * 0.25 + wobble * 0.08;
      let tz = Math.cos(frame.t * 0.22 + idHash(f.id) * 3) * 0.65;
      if (feedPt) {
        tx = feedPt.x + (idHash(f.id) - 0.5) * 0.2;
        ty = feedPt.y + (idHash(f.id + "y") - 0.5) * 0.1;
        tz = feedPt.z;
      } else if (chase > 0.35 && talkers.length > 1) {
        const rival = talkers.find((t) => t.id !== f.id && idHash(t.id) > 0.7);
        if (rival && this.opts.temperament > 0.55) {
          const other = this.fish.get(rival.id);
          if (other) {
            tx = other.x + (f.x - other.x) * 0.3;
            tz = other.z + (f.z - other.z) * 0.3;
          }
        }
      }
      const ax = (tx - f.x) * (0.8 + vigor) * dt;
      const ay = (ty - f.y) * (0.6 + vigor * 0.4) * dt;
      const az = (tz - f.z) * (0.8 + vigor) * dt;
      f.vx = f.vx * 0.92 + ax;
      f.vy = f.vy * 0.9 + ay;
      f.vz = f.vz * 0.92 + az;
      const spd = Math.hypot(f.vx, f.vy, f.vz);
      const maxSpd = 0.35 + vigor * (0.25 + chase * 0.55);
      if (spd > maxSpd && spd > 0) {
        const s = maxSpd / spd;
        f.vx *= s;
        f.vy *= s;
        f.vz *= s;
      }
      f.x = clamp(f.x + f.vx, -1.1, 1.1);
      f.y = clamp(f.y + f.vy, -0.55, 0.75);
      f.z = clamp(f.z + f.vz, -1.15, 1.15);
      f.yaw = Math.atan2(f.vx, f.vz + 0.001);
    }
  }

  step(frame: VizAquariumFrame): void {
    const talkers = frame.demo && frame.talkers.length === 0
      ? this.spawnDemoFish(frame.t)
      : frame.talkers;
    this.syncFish(talkers);
    this.ingestPackets(frame.packets);
    this.maybeFeed(frame);
    this.stepFish(frame, talkers);
    this.camPhase += Math.min(0.05, frame.dt || 1 / 60) * (this.opts.camera === "hold" ? 0 : 0.35);
    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= frame.dt || 1 / 60;
        p.y += 0.12 * (frame.dt || 1 / 60);
        if (this.opts.bubbles) p.y += 0.08 * (frame.dt || 1 / 60);
      }
    }
    if (!this.warmed) this.warmed = true;
  }

  pack(canvasW = 1280, canvasH = 800): {
    slot0: Float32Array;
    slot1: Float32Array;
    slot2: Float32Array;
    particles: Float32Array;
    particleCount: number;
    label: string;
    bright: number;
    accent: [number, number, number];
    bg: [number, number, number];
    murk: number;
    failBanner: number;
  } {
    const o = this.opts;
    const failed = clamp01(frameFailed(this.lastSys));
    const murk = failed > FAIL_MURK_THRESHOLD ? clamp01((failed - FAIL_MURK_THRESHOLD) / 0.5) : 0;
    const failBanner = murk > 0.05 ? 1 : 0;
    const dayPhase = o.dayNight
      ? 0.5 + 0.5 * Math.sin((this.lastT * 0.035 + o.seed * 0.001) % 6.283)
      : 0.85;
    const s0 = this.slot0;
    s0.fill(0);
    s0[AQU_SLOT.water] = o.water === "reef" ? 1 : 0;
    s0[AQU_SLOT.lighting] = o.lighting === "actinic" ? 1 : o.lighting === "moonlight" ? 2 : 0;
    s0[AQU_SLOT.dayPhase] = dayPhase;
    s0[AQU_SLOT.temperament] = o.temperament;
    s0[AQU_SLOT.density] = o.density;
    s0[AQU_SLOT.murk] = murk;
    s0[AQU_SLOT.failBanner] = failBanner;
    s0[AQU_SLOT.bubbles] = o.bubbles ? 1 : 0;
    s0[AQU_SLOT.camera] = o.camera === "front" ? 0 : o.camera === "hold" ? 2 : 1;
    s0[AQU_SLOT.camPhase] = this.camPhase;
    s0[AQU_SLOT.feeding] = clamp01(this.feedActive / 9);
    s0[AQU_SLOT.feedY] = this.feedY;
    s0[AQU_SLOT.canvasW] = canvasW;
    s0[AQU_SLOT.canvasH] = canvasH;
    s0[AQU_SLOT.labelOn] = o.label ? 1 : 0;
    s0[AQU_SLOT.presetNorm] = PRESET_IDS.indexOf(o.preset) / Math.max(1, PRESET_IDS.length - 1);
    s0[AQU_SLOT.seedFrac] = (o.seed % 1000) / 1000;
    s0[AQU_SLOT.fishCount] = this.fish.size;
    s0[AQU_SLOT.demo] = this.lastDemo ? 1 : 0;
    s0[AQU_SLOT.trafficBurst] = clamp01(this.lastTraffic);

    const s1 = this.slot1;
    s1.fill(0);
    let fi = 0;
    for (const f of this.fish.values()) {
      if (fi >= MAX_FISH * 4) break;
      s1[fi++] = f.x;
      s1[fi++] = f.y;
      s1[fi++] = f.z;
      s1[fi++] = f.species / 6 + f.vigor * 0.15;
    }

    const s2 = this.slot2;
    s2.fill(0);
    let pi = 0;
    let pCount = 0;
    const scratch = this.particleScratch;
    scratch.fill(0);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      if (pi >= MAX_PARTICLES * 4) break;
      s2[pi++] = p.x;
      s2[pi++] = p.y;
      s2[pi++] = p.z;
      s2[pi++] = p.kind;
      const j = pCount * 4;
      scratch[j] = p.x;
      scratch[j + 1] = p.y;
      scratch[j + 2] = p.z;
      scratch[j + 3] = p.kind;
      pCount++;
    }
    s0[AQU_SLOT.particleCount] = pCount;

    const label = aquariumHudLabel(o, this.lastDemo);
    const reef = o.water === "reef";
    const accent: [number, number, number] = reef
      ? [0.15, 0.75, 0.95]
      : [0.2, 0.82, 0.55];
    const bg: [number, number, number] = reef
      ? [0.02, 0.08, 0.14]
      : [0.03, 0.1, 0.08];
    const bright = 0.72 + this.lastAudio * 0.2 - murk * 0.25;
    return {
      slot0: s0,
      slot1: s1,
      slot2: s2,
      particles: scratch,
      particleCount: pCount,
      label,
      bright,
      accent,
      bg,
      murk,
      failBanner,
    };
  }

  private lastSys: SysRow | undefined;
  private lastDemo = false;
  private lastT = 0;
  private lastAudio = 0;
  private lastTraffic = 0;

  advance(frame: VizAquariumFrame): ReturnType<AquariumSim["pack"]> {
    this.lastSys = frame.sys;
    this.lastDemo = !!frame.demo;
    this.lastT = frame.t;
    this.lastAudio = frame.audio;
    this.lastTraffic = frame.packets.length
      ? frame.packets.reduce((s, p) => s + (p.field ?? 0), 0) / frame.packets.length
      : 0;
    this.step(frame);
    return this.pack();
  }
}

function frameFailed(sys?: SysRow): number {
  return clamp01(sys?.failed ?? 0);
}

export function failureVisuals(sys?: SysRow): { murk: number; banner: number } {
  const failed = frameFailed(sys);
  const murk = failed > FAIL_MURK_THRESHOLD ? clamp01((failed - FAIL_MURK_THRESHOLD) / 0.5) : 0;
  return { murk, banner: murk > 0.05 ? 1 : 0 };
}

/** Minimum sky luma heuristic for smoke tests (shader is procedural). */
export function aquariumSmokeLuma(packed: ReturnType<AquariumSim["pack"]>): number {
  const base = packed.bright * (0.35 + packed.slot0[AQU_SLOT.dayPhase]! * 0.25);
  const fishGlow = Math.min(0.35, packed.slot0[AQU_SLOT.fishCount]! * 0.02);
  return clamp01(base + fishGlow - packed.murk * 0.4);
}

export function fishIdStable(
  sim: AquariumSim,
  talkersA: TalkerRow[],
  talkersB: TalkerRow[],
  opts: AquariumOptions,
): boolean {
  sim.teardown();
  sim.setOptions(opts);
  sim.advance({ t: 1, dt: 0.016, audio: 0.1, talkers: talkersA, packets: [], demo: false });
  const snapA = sim.fishSpeciesById();
  sim.advance({ t: 2, dt: 0.016, audio: 0.1, talkers: talkersB, packets: [], demo: false });
  const snapB = sim.fishSpeciesById();
  if (snapA.size !== snapB.size) return false;
  for (const [id, sp] of snapA) if (snapB.get(id) !== sp) return false;
  return true;
}
