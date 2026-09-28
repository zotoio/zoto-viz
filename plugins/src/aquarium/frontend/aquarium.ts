/**
 * Aquarium viz pack — talker fish, packet bubbles, SYS murk on failure.
 * Procedural only; no bundled assets.
 */

import type { VizDataFrame, VizPacketSample, VizTalkerSample } from "../../../sdk/viz-contract";
import {
  assignTalkerSlots,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
  type TalkerSlot,
} from "./talker-slots";

export {
  assignTalkerSlots,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
} from "./talker-slots";

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
  reducedMotion: boolean;
  freshSpecies: number[];
  reefSpecies: number[];
}

type AquariumFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "talkers" | "packets" | "demo" | "sys"
>;

export const FAIL_MURK_THRESHOLD = 0.35;
export const PACKET_FRAME_CAP = 8;
export const MAX_FISH = 16;
export const MAX_PARTICLES = 24;
export const PARTICLE_STRIDE = 4;
export const FIXED_SIM_DT = 1 / 60;
export const MAX_SIM_CATCHUP_STEPS = 3;
export const MAX_TALKER_SAMPLES = 24;

/** Particle kind in slot2.w — shader distinguishes shape/colour/motion. */
export const PARTICLE_KIND_PACKET = 0.25;
export const PARTICLE_KIND_TRAFFIC_FEED = 1.15;
export const PARTICLE_KIND_SCHEDULE_FEED = 1.85;

export type FeedMode = "none" | "schedule" | "traffic";

/** Per-frame work budget (counts only; must match plugin.yml caps and sky loop). */
export const AQUARIUM_WORK_BUDGET = {
  raymarchSteps: 72,
  fishInstances: MAX_FISH,
  particles: MAX_PARTICLES,
  drawCalls: 1,
  extraGlContextsPerTile: 0,
  /** Pack does not allocate WebGL; host backdrop is shared on a 4×4 wall. */
  glContextsOn4x4Wall: 0,
} as const;

/** Set when plugin.yml lists `assets:` for host mesh lane (see sdk/pack-host-mesh.ts). */
export const PACK_HOST_MESH_ASSET: { id: string; path: string } | undefined = undefined;

/** Every visualisation.yml config key (config.read). */
export const CONFIG_KEYS = [
  "preset", "randomise", "undoRandom", "resetSettings",
  "water", "fishCount", "temperament", "feedingMin", "feedingTraffic",
  "lighting", "dayNight", "density", "bubbles", "camera", "seed", "label",
  "reducedMotion",
  "sp_neon", "sp_angel", "sp_guppy", "sp_cory", "sp_discus", "sp_cichlid", "sp_betta",
  "sp_clown", "sp_tang", "sp_damsel", "sp_goby", "sp_wrasse", "sp_anemone",
  "modelGlb",
] as const;

export const TRADEMARK_DENY = [
  /\bnemo\b/i,
  /\bfinding nemo\b/i,
  /\bmarina\b/i,
  /\baqueon\b/i,
  /\bfluval\b/i,
] as const;

export const PRESET_IDS: PresetId[] = [
  "planted",
  "reef_lagoon",
  "cichlid_rock",
  "calm_zen",
  "night_reef",
];

const FRESH_SPECIES = ["neon", "angel", "guppy", "cory", "discus", "cichlid", "betta"] as const;
const REEF_SPECIES = ["clown", "tang", "damsel", "goby", "wrasse", "anemone"] as const;

export const PRESET_CAPS: Record<PresetId, { maxFish: number; maxParticles: number }> = {
  planted: { maxFish: 18, maxParticles: 16 },
  reef_lagoon: { maxFish: 16, maxParticles: 18 },
  cichlid_rock: { maxFish: 14, maxParticles: 14 },
  calm_zen: { maxFish: 12, maxParticles: 12 },
  night_reef: { maxFish: 16, maxParticles: 20 },
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
  timeScale: 21,
  metricPeak: 22,
  raymarchSteps: 23,
  tileResScale: 24,
  labelMetric: 25,
  fishSpecies0: 26,
  fishVigor0: 42,
  feedMode: 58,
  speciesLegend: 59,
  modelFlags: 60,
} as const;

const FISH_ATTR_SLOTS = 16;

/** Pack species (0–5) and vigor (0–1) into one float for GPU slot tests. */
export function packFishMeta(species: number, vigor: number): number {
  const sp = clamp(Math.round(species), 0, 5);
  const vig = clamp01(vigor);
  return sp + vig / 64;
}

/** Inverse of {@link packFishMeta}. */
export function unpackFishMeta(packed: number): { species: number; vigor: number } {
  const sp = clamp(Math.floor(packed + 1e-4), 0, 5);
  const vig = clamp01((packed - sp) * 64);
  return { species: sp, vigor: vig };
}

/** Internal shader resolution scale for mosaic wall tiles (2×2 / 4×4). */
export function tileInternalResScale(canvasW: number, canvasH: number): number {
  const area = canvasW * canvasH;
  if (area <= 360 * 360) return 2;
  if (area <= 520 * 520) return 1.5;
  return 1;
}

function defaultStringForOptionKey(key: string): string | undefined {
  const d = DEFAULT_OPTIONS as Record<string, unknown>;
  const v = d[key];
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return undefined;
}

/** Host sends global visualisation defaults; treat those as “unset” when a preset differs. */
export function coalescePresetConfig(
  cfg?: Record<string, string> | null,
): Record<string, string> | undefined {
  if (!cfg) return cfg ?? undefined;
  const presetRaw = (cfg.preset ?? DEFAULT_OPTIONS.preset) as PresetId;
  const preset = PRESET_IDS.includes(presetRaw) ? presetRaw : DEFAULT_OPTIONS.preset;
  const pd = presetDefaults(preset);
  const out: Record<string, string> = { ...cfg };
  const scalarKeys = [
    "water", "fishCount", "temperament", "density", "lighting", "dayNight", "bubbles", "camera",
  ] as const;
  for (const key of scalarKeys) {
    const presetVal = (pd as Record<string, unknown>)[key];
    if (presetVal === undefined) continue;
    const globalDef = defaultStringForOptionKey(key);
    const cur = cfg[key];
    if (cur === undefined || (globalDef !== undefined && cur === globalDef)) {
      if (typeof presetVal === "boolean") out[key] = presetVal ? "true" : "false";
      else out[key] = String(presetVal);
    }
  }
  const freshPd = pd.freshSpecies;
  if (freshPd) {
    for (let i = 0; i < FRESH_SPECIES.length; i++) {
      const k = `sp_${FRESH_SPECIES[i]}`;
      const globalDef =
        (DEFAULT_OPTIONS.freshSpecies[i] ?? 0) !== 0 ? "true" : "false";
      const cur = cfg[k];
      if (cur === undefined || cur === globalDef) {
        out[k] = freshPd[i] ? "true" : "false";
      }
    }
  }
  const reefPd = pd.reefSpecies;
  if (reefPd) {
    for (let i = 0; i < REEF_SPECIES.length; i++) {
      const k = `sp_${REEF_SPECIES[i]}`;
      const globalDef =
        (DEFAULT_OPTIONS.reefSpecies[i] ?? 0) !== 0 ? "true" : "false";
      const cur = cfg[k];
      if (cur === undefined || cur === globalDef) {
        out[k] = reefPd[i] ? "true" : "false";
      }
    }
  }
  return out;
}

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
  reducedMotion: false,
  freshSpecies: [1, 1, 1, 1, 1, 0, 1],
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
        freshSpecies: [1, 1, 1, 1, 1, 0, 1],
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
        freshSpecies: [0, 0, 0, 0, 0, 1, 0],
      };
    case "calm_zen":
      return {
        water: "fresh",
        fishCount: 8,
        temperament: 0.08,
        density: 0.55,
        lighting: "moonlight",
        freshSpecies: [1, 1, 0, 1, 1, 0, 1],
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
  const merged = coalescePresetConfig(cfg);
  const presetRaw = (merged?.preset ?? DEFAULT_OPTIONS.preset) as PresetId;
  const preset = PRESET_IDS.includes(presetRaw) ? presetRaw : DEFAULT_OPTIONS.preset;
  const base = { ...DEFAULT_OPTIONS, ...presetDefaults(preset) };
  const cap = PRESET_CAPS[preset].maxFish;
  const waterRaw = merged?.water ?? base.water;
  const water: WaterKind = waterRaw === "reef" ? "reef" : "fresh";
  const lightingRaw = merged?.lighting ?? base.lighting;
  const lighting: LightingMode =
    lightingRaw === "actinic" || lightingRaw === "moonlight" ? lightingRaw : "daylight";
  const cameraRaw = merged?.camera ?? base.camera;
  const camera: CameraMode =
    cameraRaw === "front" || cameraRaw === "hold" ? cameraRaw : "drift";
  return {
    preset,
    water,
    fishCount: Math.round(clamp(parseNum(merged?.fishCount, base.fishCount), 2, cap)),
    temperament: clamp01(parseNum(merged?.temperament, base.temperament ?? 0.35)),
    feedingMin: clamp(parseNum(merged?.feedingMin, base.feedingMin), 0, 120),
    feedingTraffic: parseBool(merged?.feedingTraffic, base.feedingTraffic),
    lighting,
    dayNight: parseBool(merged?.dayNight, base.dayNight ?? true),
    density: clamp01(parseNum(merged?.density, base.density ?? 0.7)),
    bubbles: parseBool(merged?.bubbles, base.bubbles ?? true),
    camera,
    seed: Math.round(clamp(parseNum(merged?.seed, base.seed), 0, 99999)),
    label: parseBool(merged?.label, base.label ?? true),
    reducedMotion: parseBool(merged?.reducedMotion, base.reducedMotion ?? false),
    freshSpecies: parseSpeciesFlags(merged ?? undefined, "sp", FRESH_SPECIES, base.freshSpecies ?? DEFAULT_OPTIONS.freshSpecies),
    reefSpecies: parseSpeciesFlags(merged ?? undefined, "sp", REEF_SPECIES, base.reefSpecies ?? DEFAULT_OPTIONS.reefSpecies),
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

export function aquariumHudLabel(
  opts: AquariumOptions,
  demo: boolean,
  metric: string,
): string {
  const tail = demo ? "demo" : metric;
  return `aquarium · ${presetLabel(opts.preset)} · ${tail}`;
}

export function liveMetricLabel(
  talkers: { rate: number }[],
  sys?: { failed?: number },
): string {
  const failed = clamp01(sys?.failed ?? 0);
  if (failed > FAIL_MURK_THRESHOLD) return "fail";
  if (!talkers.length) return "idle";
  let peak = 0;
  for (const t of talkers) peak = Math.max(peak, t.rate);
  return `talkers:${talkers.length} · ${Math.round(peak)}pps`;
}

export function scanPackTrademarks(...sources: string[]): string[] {
  const hits: string[] = [];
  for (const src of sources) {
    for (const re of TRADEMARK_DENY) {
      if (re.test(src)) hits.push(String(re));
    }
  }
  return hits;
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
  private talkerSlots: (TalkerSlot | null)[] = [];
  private feedTimer = 0;
  private feedActive = 0;
  private feedMode: FeedMode = "none";
  private feedY = 0.85;
  private trafficFeedCooldown = 0;
  private camPhase = 0;
  private packetCursor = 0;
  private simAccumulator = 0;
  private seedUndo = -1;
  /** Packets consumed on the last step (bounded by {@link PACKET_FRAME_CAP}). */
  lastPacketIngest = 0;
  lastWork = { fish: 0, particles: 0, raymarchSteps: AQUARIUM_WORK_BUDGET.raymarchSteps };
  private readonly rng: () => number;
  private opts: AquariumOptions;
  readonly slot0 = new Float32Array(64);
  readonly slot1 = new Float32Array(64);
  readonly slot2 = new Float32Array(64);
  readonly particleScratch = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  private warmed = false;
  private subscriptions = 0;
  private rafHooks = 0;
  private modelSlotFloat = 1;

  setModelSlotFloat(v: number): void {
    this.modelSlotFloat = v;
  }

  constructor(opts: AquariumOptions = DEFAULT_OPTIONS) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: -2, z: 0, kind: 0, life: 0 });
    }
    this.subscriptions = 0;
    this.rafHooks = 0;
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

  fishVigorById(): Map<string, number> {
    const m = new Map<string, number>();
    for (const f of this.fish.values()) m.set(f.id, f.vigor);
    return m;
  }

  /** Fish bodies retained off-slot until the talker leaves the host list. */
  fishBodiesCount(): number {
    return this.fish.size;
  }

  slottedFishCount(): number {
    return slottedTalkerIds(this.talkerSlots).length;
  }

  randomiseSeed(): void {
    this.seedUndo = this.opts.seed;
    this.opts = { ...this.opts, seed: Math.floor(this.rng() * 99999) };
  }

  undoSeed(): void {
    if (this.seedUndo >= 0) this.opts = { ...this.opts, seed: this.seedUndo };
  }

  resetLayout(): void {
    this.talkerSlots = [];
    this.fish.clear();
    this.packetCursor = 0;
    this.simAccumulator = 0;
  }

  mountTile(): void {
    this.subscriptions++;
    this.rafHooks++;
  }

  unmountTile(): void {
    this.teardown();
    this.subscriptions = Math.max(0, this.subscriptions - 1);
    this.rafHooks = Math.max(0, this.rafHooks - 1);
  }

  teardown(): void {
    this.fish.clear();
    this.feedTimer = 0;
    this.feedActive = 0;
    this.packetCursor = 0;
    this.simAccumulator = 0;
    this.talkerSlots = [];
    for (const p of this.particles) {
      p.life = 0;
      p.y = -2;
    }
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  fishSlotCap(): number {
    return Math.min(
      this.opts.fishCount,
      PRESET_CAPS[this.opts.preset].maxFish,
      MAX_FISH,
    );
  }

  talkerSlotsSnapshot(): (TalkerSlot | null)[] {
    return this.talkerSlots.slice();
  }

  private slottedTalkers(all: VizTalkerSample[], simT: number): VizTalkerSample[] {
    const cap = this.fishSlotCap();
    this.talkerSlots = assignTalkerSlots(all, this.talkerSlots, cap, simT);
    const byId = new Map(all.map((t) => [t.id, t]));
    const out: VizTalkerSample[] = [];
    for (const id of slottedTalkerIds(this.talkerSlots)) {
      const t = byId.get(id);
      if (t) out.push(t);
    }
    return out;
  }

  private syncFish(slotted: VizTalkerSample[], allTalkerIds: Set<string>, all: VizTalkerSample[]): void {
    const slottedSet = new Set(slotted.map((t) => t.id));
    const byId = new Map(all.map((t) => [t.id, t]));
    for (const t of all) {
      const inSlot = slottedSet.has(t.id);
      let f = this.fish.get(t.id);
      if (!f && inSlot) {
        const h = idHash(t.id);
        f = {
          id: t.id,
          species: speciesForTalker(t.id, t.role, this.opts),
          vigor: vigorFromRate(t.rate),
          x: (h - 0.5) * 1.2,
          y: 0.1 + (h * 0.7) % 0.35,
          z: ((h * 3.1) % 1 - 0.5) * 1.4,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: h * 6.28,
        };
        this.fish.set(t.id, f);
      } else if (f && inSlot) {
        const row = byId.get(t.id)!;
        f.species = speciesForTalker(row.id, row.role, this.opts);
        f.vigor = vigorFromRate(row.rate);
      }
    }
    for (const id of [...this.fish.keys()]) {
      if (!allTalkerIds.has(id)) this.fish.delete(id);
    }
  }

  private trimActiveParticlesToCap(): void {
    const cap = PRESET_CAPS[this.opts.preset].maxParticles;
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

  private ingestPackets(packets: VizPacketSample[]): void {
    let n = 0;
    this.lastPacketIngest = 0;
    if (!packets.length) return;
    let idx = this.packetCursor % packets.length;
    let scanned = 0;
    while (n < PACKET_FRAME_CAP && scanned < packets.length) {
      const p = packets[idx]!;
      idx = (idx + 1) % packets.length;
      scanned++;
      let slot: ParticleBody | null = null;
      for (const q of this.particles) {
        if (q.life <= 0) {
          slot = q;
          break;
        }
      }
      if (!slot) break;
      const h = idHash(p.proto);
      slot.x = (h - 0.5) * 1.5;
      slot.y = -0.6 + p.size / 2000;
      slot.z = (idHash(p.proto + "z") - 0.5) * 1.2;
      slot.kind = PARTICLE_KIND_PACKET + clamp01(p.size / 1500) * 0.35;
      slot.life = 2.5 + p.field;
      n++;
      this.lastPacketIngest++;
    }
    this.packetCursor = idx;
    this.trimActiveParticlesToCap();
  }

  private spawnFeedParticles(kind: number, count: number): void {
    const cap = PRESET_CAPS[this.opts.preset].maxParticles;
    let active = 0;
    for (const q of this.particles) if (q.life > 0) active++;
    for (let n = 0; n < count; n++) {
      if (active >= cap) break;
      let slot: ParticleBody | null = null;
      for (const q of this.particles) {
        if (q.life <= 0) {
          slot = q;
          break;
        }
      }
      if (!slot) break;
      const h = idHash(`feed:${n}:${this.lastT}`);
      slot.x = (h - 0.5) * 0.35;
      slot.y = this.feedY + (idHash(`fy${n}`) - 0.5) * 0.08;
      slot.z = 0.1 + (idHash(`fz${n}`) - 0.5) * 0.25;
      slot.kind = kind;
      slot.life = kind >= PARTICLE_KIND_SCHEDULE_FEED ? 4.5 : 3.2;
      active++;
    }
    this.trimActiveParticlesToCap();
  }

  /** Schedule and traffic feed triggers — once per host frame (not per catch-up substep). */
  private runFeedTriggers(dt: number, packets: VizPacketSample[]): void {
    if (this.opts.feedingMin > 0) {
      this.feedTimer += dt;
      if (this.feedTimer >= this.opts.feedingMin * 60) {
        this.feedTimer = 0;
        this.feedActive = 9;
        this.feedY = 0.82;
        this.feedMode = "schedule";
        this.spawnFeedParticles(PARTICLE_KIND_SCHEDULE_FEED, 6);
      }
    }
    if (
      this.opts.feedingTraffic
      && this.trafficFeedCooldown <= 0
      && packets.length >= 3
    ) {
      const burst = packets.reduce((s, p) => s + (p.field ?? 0), 0) / packets.length;
      if (burst > 0.55) {
        this.feedActive = Math.max(this.feedActive, 5);
        if (this.feedMode !== "schedule") this.feedMode = "traffic";
        this.spawnFeedParticles(PARTICLE_KIND_TRAFFIC_FEED, 4);
        this.trafficFeedCooldown = 0.45;
      }
    }
    this.trimActiveParticlesToCap();
  }

  private tickFeed(dt: number): void {
    if (this.trafficFeedCooldown > 0) {
      this.trafficFeedCooldown = Math.max(0, this.trafficFeedCooldown - dt);
    }
    if (this.feedActive > 0) {
      this.feedActive -= dt;
      this.feedY -= dt * 0.06;
    } else {
      this.feedMode = "none";
    }
  }

  private stepFish(simT: number, dt: number, slotted: VizTalkerSample[]): void {
    const calm = 1 - this.opts.temperament;
    const school = 0.35 + calm * 0.45;
    const chase = this.opts.temperament * 0.9;
    const feedPt = this.feedActive > 0 ? { x: 0, y: this.feedY, z: 0.2 } : null;
    const slottedSet = new Set(slotted.map((t) => t.id));
    for (const f of this.fish.values()) {
      if (!slottedSet.has(f.id)) continue;
      const talker = slotted.find((t) => t.id === f.id);
      const vigor = talker ? vigorFromRate(talker.rate) : f.vigor;
      f.vigor = vigor;
      const wobble = Math.sin(simT * (1.2 + vigor) + idHash(f.id) * 9) * 0.15 * school;
      let tx = Math.sin(simT * 0.25 + idHash(f.id) * 4) * (0.55 + calm * 0.25);
      let ty = 0.05 + vigor * 0.25 + wobble * 0.08;
      let tz = Math.cos(simT * 0.22 + idHash(f.id) * 3) * 0.65;
      if (feedPt) {
        tx = feedPt.x + (idHash(f.id) - 0.5) * 0.2;
        ty = feedPt.y + (idHash(f.id + "y") - 0.5) * 0.1;
        tz = feedPt.z;
      } else if (chase > 0.35) {
        tx += Math.sin(simT * 0.9 + idHash(f.id) * 5) * chase * 0.12;
        tz += Math.cos(simT * 0.85 + idHash(f.id) * 4) * chase * 0.12;
      }
      // Cruise along the nose. A point behind the fish turns them; it does not pull them tail-first.
      let sx = tx - f.x;
      let sz = tz - f.z;
      const wall = 0.9;
      if (f.x > wall) sx -= (f.x - wall) * 3;
      if (f.x < -wall) sx += (-wall - f.x) * 3;
      if (f.z > wall) sz -= (f.z - wall) * 3;
      if (f.z < -wall) sz += (-wall - f.z) * 3;
      const desired = Math.atan2(sx, sz + 0.0001);
      let dyaw = Math.atan2(Math.sin(desired - f.yaw), Math.cos(desired - f.yaw));
      const nearWall = Math.abs(f.x) > wall || Math.abs(f.z) > wall;
      const turn = (nearWall ? 2.6 : 0.85 + vigor * 1.15 + (feedPt ? 0.7 : 0)) * dt;
      if (dyaw > turn) dyaw = turn;
      else if (dyaw < -turn) dyaw = -turn;
      f.yaw += dyaw;
      const fx = Math.sin(f.yaw);
      const fz = Math.cos(f.yaw);
      const cruise = (0.0024 + vigor * 0.0024) * (0.75 + chase);
      const facing = sx * fx + sz * fz;
      const speed = cruise * (facing < 0 ? 0.7 : 1);
      f.vx = fx * speed;
      f.vz = fz * speed;
      const ay = (ty - f.y) * (0.6 + vigor * 0.4) * dt;
      f.vy = f.vy * 0.9 + ay;
      f.x = clamp(f.x + f.vx, -1.1, 1.1);
      f.y = clamp(f.y + f.vy, -0.55, 0.75);
      f.z = clamp(f.z + f.vz, -1.15, 1.15);
    }
  }

  private stepOnce(simT: number, allTalkers: VizTalkerSample[]): void {
    const allIds = new Set(allTalkers.map((t) => t.id));
    const slotted = this.slottedTalkers(allTalkers, simT);
    this.syncFish(slotted, allIds, allTalkers);
    this.tickFeed(FIXED_SIM_DT);
    this.stepFish(simT, FIXED_SIM_DT, slotted);
    const motion = this.opts.reducedMotion || this.opts.camera === "hold";
    const camRate = motion ? 0 : 0.35;
    this.camPhase += FIXED_SIM_DT * camRate;
    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= FIXED_SIM_DT;
        if (p.kind >= PARTICLE_KIND_SCHEDULE_FEED) {
          p.y -= 0.05 * FIXED_SIM_DT;
          p.x += Math.sin(simT * 2.2 + p.z * 8) * 0.02 * FIXED_SIM_DT;
        } else if (p.kind >= PARTICLE_KIND_TRAFFIC_FEED) {
          p.y -= 0.02 * FIXED_SIM_DT;
          p.x += Math.cos(simT * 3.5 + p.x * 5) * 0.03 * FIXED_SIM_DT;
        } else {
          p.y += 0.12 * FIXED_SIM_DT;
          if (this.opts.bubbles) p.y += 0.08 * FIXED_SIM_DT;
        }
      }
    }
    let activeParticles = 0;
    for (const p of this.particles) if (p.life > 0) activeParticles++;
    this.lastWork = {
      fish: this.fish.size,
      particles: activeParticles,
      raymarchSteps: AQUARIUM_WORK_BUDGET.raymarchSteps,
    };
    if (!this.warmed) this.warmed = true;
  }

  step(frame: AquariumFrame): void {
    const talkers = frame.talkers;
    this.ingestPackets(frame.packets);
    const frameDt = Math.min(0.1, frame.dt || FIXED_SIM_DT);
    this.runFeedTriggers(Math.min(0.05, frameDt), frame.packets);
    this.simAccumulator += frameDt;
    let steps = 0;
    while (this.simAccumulator >= FIXED_SIM_DT && steps < MAX_SIM_CATCHUP_STEPS) {
      this.stepOnce(frame.t, talkers);
      this.simAccumulator -= FIXED_SIM_DT;
      steps++;
    }
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
    const murk = failed > FAIL_MURK_THRESHOLD
      ? clamp01((failed - FAIL_MURK_THRESHOLD) / 0.38)
      : 0;
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
    const motion = o.reducedMotion ? 2 : o.camera === "front" ? 0 : o.camera === "hold" ? 2 : 1;
    s0[AQU_SLOT.camera] = motion;
    s0[AQU_SLOT.camPhase] = this.camPhase;
    s0[AQU_SLOT.feeding] = clamp01(this.feedActive / 9);
    s0[AQU_SLOT.feedY] = this.feedY;
    s0[AQU_SLOT.canvasW] = canvasW;
    s0[AQU_SLOT.canvasH] = canvasH;
    s0[AQU_SLOT.labelOn] = o.label ? 1 : 0;
    s0[AQU_SLOT.presetNorm] = PRESET_IDS.indexOf(o.preset) / Math.max(1, PRESET_IDS.length - 1);
    s0[AQU_SLOT.seedFrac] = (o.seed % 1000) / 1000;
    const packedIds = slottedTalkerIds(this.talkerSlots);
    s0[AQU_SLOT.fishCount] = packedIds.length;
    s0[AQU_SLOT.demo] = this.lastDemo ? 1 : 0;
    s0[AQU_SLOT.trafficBurst] = clamp01(this.lastTraffic);
    s0[AQU_SLOT.timeScale] = o.reducedMotion || o.camera === "hold" ? 0.2 : 1;
    let peak = 0;
    for (const t of this.lastTalkers) peak = Math.max(peak, t.rate);
    s0[AQU_SLOT.metricPeak] = clamp01(peak / 220);
    s0[AQU_SLOT.raymarchSteps] = AQUARIUM_WORK_BUDGET.raymarchSteps;
    s0[AQU_SLOT.tileResScale] = tileInternalResScale(canvasW, canvasH);
    const failedVis = frameFailed(this.lastSys);
    const labelMetric = !o.label
      ? 0
      : this.lastDemo
        ? 2
        : failedVis > FAIL_MURK_THRESHOLD
          ? 3
          : this.lastTalkers.length
            ? 1
            : 0;
    s0[AQU_SLOT.labelMetric] = labelMetric;
    s0[AQU_SLOT.feedMode] = this.feedMode === "schedule" ? 2 : this.feedMode === "traffic" ? 1 : 0;
    const spFlags = o.water === "reef" ? o.reefSpecies : o.freshSpecies;
    let legendMask = 0;
    for (let i = 0; i < Math.min(6, spFlags.length); i++) if (spFlags[i]) legendMask |= 1 << i;
    s0[AQU_SLOT.speciesLegend] = legendMask;
    s0[AQU_SLOT.modelFlags] = this.modelSlotFloat;
    for (let i = 0; i < FISH_ATTR_SLOTS; i++) {
      s0[AQU_SLOT.fishSpecies0 + i] = 0;
      s0[AQU_SLOT.fishVigor0 + i] = 0;
    }
    let fishIdx = 0;
    for (const id of packedIds) {
      if (fishIdx >= FISH_ATTR_SLOTS) break;
      const f = this.fish.get(id);
      if (!f) continue;
      s0[AQU_SLOT.fishSpecies0 + fishIdx] = f.species;
      s0[AQU_SLOT.fishVigor0 + fishIdx] = f.vigor;
      fishIdx++;
    }

    const s1 = this.slot1;
    s1.fill(0);
    let fi = 0;
    for (const id of packedIds) {
      if (fi >= MAX_FISH * 4) break;
      const f = this.fish.get(id);
      if (!f) continue;
      s1[fi++] = f.x;
      s1[fi++] = f.y;
      s1[fi++] = f.z;
      s1[fi++] = f.yaw;
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

    const metric = this.lastDemo
      ? "demo"
      : liveMetricLabel(this.lastTalkers, this.lastSys);
    const label = aquariumHudLabel(o, this.lastDemo, metric);
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

  private lastSys: { failed?: number } | undefined;
  private lastDemo = false;
  private lastT = 0;
  private lastAudio = 0;
  private lastTraffic = 0;
  private lastTalkers: VizTalkerSample[] = [];

  advance(frame: AquariumFrame, canvasW = 1280, canvasH = 800): ReturnType<AquariumSim["pack"]> {
    this.lastSys = frame.sys;
    this.lastDemo = !!frame.demo;
    this.lastT = frame.t;
    this.lastAudio = frame.audio;
    this.lastTalkers = frame.talkers;
    let traffic = 0;
    for (const p of frame.packets) traffic += p.field;
    this.lastTraffic = frame.packets.length ? traffic / frame.packets.length : 0;
    this.step(frame);
    return this.pack(canvasW, canvasH);
  }

  tileSubscriptions(): number {
    return this.subscriptions;
  }

  tileRafHooks(): number {
    return this.rafHooks;
  }
}

function frameFailed(sys?: { failed?: number }): number {
  return clamp01(sys?.failed ?? 0);
}

export function failureVisuals(sys?: { failed?: number }): { murk: number; banner: number } {
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
  talkersA: VizTalkerSample[],
  talkersB: VizTalkerSample[],
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

export type ConfigActionEdges = {
  resetSettings?: boolean;
  randomise?: boolean;
  undoRandom?: boolean;
};

/** Config side-effects (randomise / undo / reset) — still driven only via config.read. */
export function applyConfigActions(
  sim: AquariumSim,
  cfg: Record<string, string> | undefined,
  next: AquariumOptions,
  edges: ConfigActionEdges = {},
): AquariumOptions {
  let opts = next;
  if (edges.resetSettings) {
    opts = parseAquariumOptions({ preset: next.preset });
    sim.resetLayout();
  }
  if (edges.randomise) sim.randomiseSeed();
  if (edges.undoRandom) sim.undoSeed();
  opts = { ...opts, seed: sim.getOptions().seed };
  sim.setOptions(opts);
  return opts;
}

/** Rising-edge detect for persisted boolean toggles in visualisation.yml. */
export function configActionEdges(
  cfg: Record<string, string> | undefined,
  prev: { reset: boolean; randomise: boolean; undo: boolean },
): { edges: ConfigActionEdges; next: typeof prev } {
  const reset = parseBool(cfg?.resetSettings, false);
  const randomise = parseBool(cfg?.randomise, false);
  const undo = parseBool(cfg?.undoRandom, false);
  return {
    edges: {
      resetSettings: reset && !prev.reset,
      randomise: randomise && !prev.randomise,
      undoRandom: undo && !prev.undo,
    },
    next: { reset, randomise, undo },
  };
}

export function assertWorkBudgetUnderCaps(
  work: { fish: number; particles: number; raymarchSteps: number },
  preset: PresetId,
): boolean {
  const cap = PRESET_CAPS[preset];
  return (
    work.fish <= cap.maxFish
    && work.fish <= MAX_FISH
    && work.particles <= cap.maxParticles
    && work.particles <= MAX_PARTICLES
    && work.raymarchSteps <= AQUARIUM_WORK_BUDGET.raymarchSteps
  );
}
