/**
 * Koi pond viz pack — talkers are koi, destinations are lily pads & lotus.
 * Procedural GLSL sky; demo schools when the host idle fixture is active.
 */

import type {
  VizDataFrame,
  VizPacketSample,
  VizTalkerSample,
} from "../../../sdk/viz-contract";
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

export type KoiPatternId = "kohaku" | "sanke" | "showa" | "ogon" | "tancho" | "asagi";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type CameraAngle = "top" | "angled";
export type LotusColour = "pink" | "white" | "mixed";
export type QualityLevel = "low" | "medium" | "high";

export interface KoiPondOptions {
  koiCap: number;
  koiSize: number;
  varietyMix: number;
  swimSpeed: number;
  schooling: number;
  lilyDensity: number;
  lotusCount: number;
  lotusColour: LotusColour;
  bloomOnActivity: boolean;
  waterTint: number;
  waterClarity: number;
  rippleIntensity: number;
  caustics: boolean;
  causticStrength: number;
  petalDrift: boolean;
  dragonflies: boolean;
  timeOfDay: TimeOfDay;
  rain: boolean;
  cameraAngle: CameraAngle;
  cameraDrift: boolean;
  label: boolean;
  legend: boolean;
  quality: QualityLevel;
  seed: number;
  reducedMotion: boolean;
  patternFlags: number[];
}

type KoiPondFrame = Pick<
  VizDataFrame,
  "t" | "dt" | "audio" | "talkers" | "packets" | "sys" | "demo"
>;

export const FAIL_MURK_THRESHOLD = 0.35;
export const PACKET_FRAME_CAP = 8;
export const MAX_KOI = 16;
export const MAX_PADS = 12;
export const MAX_PARTICLES = 24;
export const PARTICLE_STRIDE = 4;
export const FIXED_SIM_DT = 1 / 60;
export const MAX_SIM_CATCHUP_STEPS = 3;

export const PARTICLE_KIND_RIPPLE = 0.2;
export const PARTICLE_KIND_PETAL = 1.1;
export const PARTICLE_KIND_EVENT = 1.85;

export const KOI_PATTERNS: KoiPatternId[] = [
  "kohaku",
  "sanke",
  "showa",
  "ogon",
  "tancho",
  "asagi",
];

export const KOI_WORK_BUDGET = {
  raymarchSteps: 64,
  koiInstances: MAX_KOI,
  pads: MAX_PADS,
  particles: MAX_PARTICLES,
  drawCalls: 1,
  glContextsOn4x4Wall: 0,
} as const;

export const CONFIG_KEYS = [
  "koiCap",
  "koiSize",
  "varietyMix",
  "swimSpeed",
  "schooling",
  "lilyDensity",
  "lotusCount",
  "lotusColour",
  "bloomOnActivity",
  "waterTint",
  "waterClarity",
  "rippleIntensity",
  "caustics",
  "causticStrength",
  "petalDrift",
  "dragonflies",
  "timeOfDay",
  "rain",
  "cameraAngle",
  "cameraDrift",
  "label",
  "legend",
  "quality",
  "seed",
  "reducedMotion",
  "pat_kohaku",
  "pat_sanke",
  "pat_showa",
  "pat_ogon",
  "pat_tancho",
  "pat_asagi",
] as const;

export const QUALITY_CAPS: Record<QualityLevel, { maxKoi: number; maxParticles: number; steps: number }> = {
  low: { maxKoi: 8, maxParticles: 10, steps: 40 },
  medium: { maxKoi: 12, maxParticles: 16, steps: 56 },
  high: { maxKoi: 16, maxParticles: 24, steps: 64 },
};

export const KOI_SLOT = {
  waterTint: 0,
  clarity: 1,
  murk: 2,
  failBanner: 3,
  schooling: 4,
  swimSpeed: 5,
  lilyDensity: 6,
  lotusCount: 7,
  lotusColour: 8,
  bloomOn: 9,
  ripple: 10,
  causticsOn: 11,
  causticStrength: 12,
  petalsOn: 13,
  dragonfliesOn: 14,
  timeOfDay: 15,
  rainOn: 16,
  cameraAngle: 17,
  camPhase: 18,
  canvasW: 19,
  canvasH: 20,
  labelOn: 21,
  legendOn: 22,
  seedFrac: 23,
  koiCount: 24,
  particleCount: 25,
  demo: 26,
  timeScale: 27,
  metricPeak: 28,
  raymarchSteps: 29,
  tileResScale: 30,
  labelMetric: 31,
  sizeScale: 32,
  varietyMix: 33,
  patternLegend: 34,
  koiPattern0: 35,
  koiVigor0: 48,
} as const;

const KOI_ATTR_SLOTS = 13;
const PAD_SLOTS = 12;

export function packKoiMeta(pattern: number, vigor: number): number {
  const p = clamp(Math.round(pattern), 0, 5);
  const v = clamp01(vigor);
  return p + v / 64;
}

export function unpackKoiMeta(packed: number): { pattern: number; vigor: number } {
  const p = clamp(Math.floor(packed + 1e-4), 0, 5);
  const v = clamp01((packed - p) * 64);
  return { pattern: p, vigor: v };
}

export function tileInternalResScale(canvasW: number, canvasH: number): number {
  const area = canvasW * canvasH;
  if (area <= 360 * 360) return 2;
  if (area <= 520 * 520) return 1.5;
  return 1;
}

export const DEFAULT_OPTIONS: KoiPondOptions = {
  koiCap: 12,
  koiSize: 1,
  varietyMix: 0.65,
  swimSpeed: 0.55,
  schooling: 0.45,
  lilyDensity: 0.7,
  lotusCount: 4,
  lotusColour: "mixed",
  bloomOnActivity: true,
  waterTint: 0.42,
  waterClarity: 0.72,
  rippleIntensity: 0.65,
  caustics: true,
  causticStrength: 0.55,
  petalDrift: true,
  dragonflies: true,
  timeOfDay: "day",
  rain: false,
  cameraAngle: "angled",
  cameraDrift: true,
  label: true,
  legend: true,
  quality: "medium",
  seed: 5150,
  reducedMotion: false,
  patternFlags: [1, 1, 1, 1, 1, 1],
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

function parsePatternFlags(cfg?: Record<string, string> | null): number[] {
  return KOI_PATTERNS.map((name, i) => {
    const key = `pat_${name}`;
    if (cfg?.[key] === undefined) return DEFAULT_OPTIONS.patternFlags[i] ?? 1;
    return parseBool(cfg[key], true) ? 1 : 0;
  });
}

export function parseKoiPondOptions(cfg?: Record<string, string> | null): KoiPondOptions {
  const cap = QUALITY_CAPS[
    (cfg?.quality === "low" || cfg?.quality === "high" ? cfg.quality : "medium") as QualityLevel
  ];
  const timeRaw = cfg?.timeOfDay ?? DEFAULT_OPTIONS.timeOfDay;
  const timeOfDay: TimeOfDay =
    timeRaw === "dawn" || timeRaw === "dusk" || timeRaw === "night" ? timeRaw : "day";
  const lotusRaw = cfg?.lotusColour ?? DEFAULT_OPTIONS.lotusColour;
  const lotusColour: LotusColour =
    lotusRaw === "pink" || lotusRaw === "white" ? lotusRaw : "mixed";
  const camRaw = cfg?.cameraAngle ?? DEFAULT_OPTIONS.cameraAngle;
  const cameraAngle: CameraAngle = camRaw === "top" ? "top" : "angled";
  const quality: QualityLevel =
    cfg?.quality === "low" || cfg?.quality === "high" ? cfg.quality : "medium";
  return {
    koiCap: Math.round(clamp(parseNum(cfg?.koiCap, DEFAULT_OPTIONS.koiCap), 2, cap.maxKoi)),
    koiSize: clamp(parseNum(cfg?.koiSize, DEFAULT_OPTIONS.koiSize), 0.5, 1.8),
    varietyMix: clamp01(parseNum(cfg?.varietyMix, DEFAULT_OPTIONS.varietyMix)),
    swimSpeed: clamp01(parseNum(cfg?.swimSpeed, DEFAULT_OPTIONS.swimSpeed)),
    schooling: clamp01(parseNum(cfg?.schooling, DEFAULT_OPTIONS.schooling)),
    lilyDensity: clamp01(parseNum(cfg?.lilyDensity, DEFAULT_OPTIONS.lilyDensity)),
    lotusCount: Math.round(clamp(parseNum(cfg?.lotusCount, DEFAULT_OPTIONS.lotusCount), 0, 8)),
    lotusColour,
    bloomOnActivity: parseBool(cfg?.bloomOnActivity, DEFAULT_OPTIONS.bloomOnActivity),
    waterTint: clamp01(parseNum(cfg?.waterTint, DEFAULT_OPTIONS.waterTint)),
    waterClarity: clamp01(parseNum(cfg?.waterClarity, DEFAULT_OPTIONS.waterClarity)),
    rippleIntensity: clamp01(parseNum(cfg?.rippleIntensity, DEFAULT_OPTIONS.rippleIntensity)),
    caustics: parseBool(cfg?.caustics, DEFAULT_OPTIONS.caustics),
    causticStrength: clamp01(parseNum(cfg?.causticStrength, DEFAULT_OPTIONS.causticStrength)),
    petalDrift: parseBool(cfg?.petalDrift, DEFAULT_OPTIONS.petalDrift),
    dragonflies: parseBool(cfg?.dragonflies, DEFAULT_OPTIONS.dragonflies),
    timeOfDay,
    rain: parseBool(cfg?.rain, DEFAULT_OPTIONS.rain),
    cameraAngle,
    cameraDrift: parseBool(cfg?.cameraDrift, DEFAULT_OPTIONS.cameraDrift),
    label: parseBool(cfg?.label, DEFAULT_OPTIONS.label),
    legend: parseBool(cfg?.legend, DEFAULT_OPTIONS.legend),
    quality,
    seed: Math.round(clamp(parseNum(cfg?.seed, DEFAULT_OPTIONS.seed), 0, 99999)),
    reducedMotion: parseBool(cfg?.reducedMotion, DEFAULT_OPTIONS.reducedMotion),
    patternFlags: parsePatternFlags(cfg),
  };
}

export function koiPondHudLabel(opts: KoiPondOptions, demo: boolean, metric: string): string {
  const tail = demo ? "demo" : metric;
  return `koi pond · ${opts.timeOfDay} · ${tail}`;
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

export function packNameCheck(): { id: string; name: string; view: string } {
  return { id: "koi-pond", name: "Koi Pond", view: "plugin:koi-pond" };
}

function enabledPatterns(opts: KoiPondOptions): number[] {
  const out: number[] = [];
  for (let i = 0; i < opts.patternFlags.length; i++) if (opts.patternFlags[i]) out.push(i);
  if (!out.length) out.push(0);
  return out;
}

export function patternForTalker(id: string, role: string, opts: KoiPondOptions): number {
  const enabled = enabledPatterns(opts);
  const h = idHash(id);
  if (role === "gateway") return enabled.includes(0) ? 0 : enabled[0]!;
  if (role === "internet") return enabled.includes(2) ? 2 : enabled[Math.min(1, enabled.length - 1)]!;
  if (role === "lan") return enabled[Math.floor(h * enabled.length) % enabled.length]!;
  return enabled[Math.floor(h * enabled.length) % enabled.length]!;
}

export function vigorFromRate(rate: number): number {
  return clamp01(rate / 220);
}


interface KoiBody {
  id: string;
  pattern: number;
  vigor: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  padIndex: number;
}

interface PadBody {
  id: string;
  x: number;
  z: number;
  bloom: number;
  activity: number;
}

interface ParticleBody {
  x: number;
  y: number;
  z: number;
  kind: number;
  life: number;
}

export class KoiPondSim {
  private readonly koi = new Map<string, KoiBody>();
  private readonly pads: PadBody[] = [];
  private readonly particles: ParticleBody[] = [];
  private talkerSlots: (TalkerSlot | null)[] = [];
  private camPhase = 0;
  private packetCursor = 0;
  private simAccumulator = 0;
  lastPacketIngest = 0;
  lastWork = { koi: 0, particles: 0, raymarchSteps: KOI_WORK_BUDGET.raymarchSteps };
  private opts: KoiPondOptions;
  readonly slot0 = new Float32Array(64);
  readonly slot1 = new Float32Array(64);
  readonly slot2 = new Float32Array(64);
  readonly particleScratch = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  private warmed = false;
  private subscriptions = 0;
  private rafHooks = 0;
  private glDisposals = 0;

  constructor(opts: KoiPondOptions = DEFAULT_OPTIONS) {
    this.opts = opts;
    this.initPads();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: -2, z: 0, kind: 0, life: 0 });
    }
  }

  private initPads(): void {
    this.pads.length = 0;
    const n = Math.min(MAX_PADS, Math.round(4 + this.opts.lilyDensity * 8));
    for (let i = 0; i < n; i++) {
      const h = idHash(`pad:${i}:${this.opts.seed}`);
      this.pads.push({
        id: `pad:${i}`,
        x: (h - 0.5) * 1.6,
        z: ((h * 2.7) % 1 - 0.5) * 1.4,
        bloom: 0.15,
        activity: 0,
      });
    }
  }

  setOptions(opts: KoiPondOptions): void {
    const regen = opts.lilyDensity !== this.opts.lilyDensity || opts.seed !== this.opts.seed;
    this.opts = opts;
    if (regen) this.initPads();
  }

  getOptions(): KoiPondOptions {
    return this.opts;
  }

  koiPatternById(): Map<string, number> {
    const m = new Map<string, number>();
    for (const k of this.koi.values()) m.set(k.id, k.pattern);
    return m;
  }

  koiBodiesCount(): number {
    return this.koi.size;
  }

  slottedKoiCount(): number {
    return slottedTalkerIds(this.talkerSlots).length;
  }

  talkerSlotsSnapshot(): (TalkerSlot | null)[] {
    return this.talkerSlots.slice();
  }

  mountTile(): void {
    this.subscriptions++;
    this.rafHooks++;
  }

  unmountTile(): void {
    this.teardown();
    this.subscriptions = Math.max(0, this.subscriptions - 1);
    this.rafHooks = Math.max(0, this.rafHooks - 1);
    this.glDisposals++;
  }

  teardown(): void {
    this.koi.clear();
    this.packetCursor = 0;
    this.simAccumulator = 0;
    this.talkerSlots = [];
    for (const p of this.particles) {
      p.life = 0;
      p.y = -2;
    }
    this.glDisposals++;
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  tileSubscriptions(): number {
    return this.subscriptions;
  }

  tileRafHooks(): number {
    return this.rafHooks;
  }

  glDisposeCount(): number {
    return this.glDisposals;
  }

  private koiSlotCap(): number {
    const cap = QUALITY_CAPS[this.opts.quality];
    return Math.min(this.opts.koiCap, cap.maxKoi, MAX_KOI);
  }

  private padForTalker(t: VizTalkerSample): number {
    const h = idHash(t.id);
    const lotusSlots = Math.min(this.opts.lotusCount, this.pads.length);
    if (lotusSlots > 0 && h > 0.55) return Math.floor(h * lotusSlots) % lotusSlots;
    const start = lotusSlots;
    const count = Math.max(1, this.pads.length - start);
    return start + Math.floor(idHash(`${t.id}:dst`) * count) % count;
  }

  private slottedTalkers(all: VizTalkerSample[], simT: number): VizTalkerSample[] {
    const cap = this.koiSlotCap();
    this.talkerSlots = assignTalkerSlots(all, this.talkerSlots, cap, simT);
    const byId = new Map(all.map((t) => [t.id, t]));
    const out: VizTalkerSample[] = [];
    for (const id of slottedTalkerIds(this.talkerSlots)) {
      const t = byId.get(id);
      if (t) out.push(t);
    }
    return out;
  }

  private syncKoi(slotted: VizTalkerSample[], allTalkerIds: Set<string>, all: VizTalkerSample[]): void {
    const slottedSet = new Set(slotted.map((t) => t.id));
    const byId = new Map(all.map((t) => [t.id, t]));
    for (const t of all) {
      const inSlot = slottedSet.has(t.id);
      let k = this.koi.get(t.id);
      if (!k && inSlot) {
        const h = idHash(t.id);
        k = {
          id: t.id,
          pattern: patternForTalker(t.id, t.role, this.opts),
          vigor: vigorFromRate(t.rate),
          x: (h - 0.5) * 1.2,
          z: ((h * 3.1) % 1 - 0.5) * 1.2,
          vx: 0,
          vz: 0,
          yaw: h * 6.28,
          padIndex: this.padForTalker(t),
        };
        this.koi.set(t.id, k);
      } else if (k && inSlot) {
        const row = byId.get(t.id)!;
        k.pattern = patternForTalker(row.id, row.role, this.opts);
        k.vigor = vigorFromRate(row.rate);
        k.padIndex = this.padForTalker(row);
      }
    }
    for (const id of [...this.koi.keys()]) {
      if (!allTalkerIds.has(id)) this.koi.delete(id);
    }
  }

  /** Built-in demo talkers — always lively on empty host / CI. */
  spawnDemoTalkers(t: number): VizTalkerSample[] {
    const n = Math.min(this.opts.koiCap, 6);
    const out: VizTalkerSample[] = [];
    for (let i = 0; i < n; i++) {
      const roles = ["gateway", "lan", "internet", "lan", "internet", "lan"];
      out.push({
        id: `demo:${i}:${this.opts.seed}`,
        rate: 70 + 35 * Math.sin(t * 0.45 + i * 0.9),
        role: roles[i % roles.length]!,
      });
    }
    return out;
  }

  private ingestPackets(packets: VizPacketSample[]): void {
    let n = 0;
    this.lastPacketIngest = 0;
    if (!packets.length) return;
    let idx = this.packetCursor % packets.length;
    let scanned = 0;
    const rippleBoost = this.opts.rippleIntensity;
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
      slot.y = 0.02;
      slot.z = (idHash(p.proto + "z") - 0.5) * 1.2;
      slot.kind = PARTICLE_KIND_RIPPLE + clamp01(p.field) * 0.4 * rippleBoost;
      slot.life = 2.2 + p.field * rippleBoost;
      n++;
      this.lastPacketIngest++;
      const pad = this.pads[Math.floor(h * this.pads.length) % this.pads.length];
      if (pad) pad.activity = clamp01(pad.activity + 0.15 + p.field * 0.2);
    }
    this.packetCursor = idx;
    this.trimParticles();
  }

  private trimParticles(): void {
    const cap = QUALITY_CAPS[this.opts.quality].maxParticles;
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

  private spawnPetals(simT: number): void {
    if (!this.opts.petalDrift) return;
    const cap = QUALITY_CAPS[this.opts.quality];
    if (cap.maxParticles < 6) return;
    if (Math.sin(simT * 0.3) < 0.92) return;
    let slot: ParticleBody | null = null;
    for (const q of this.particles) {
      if (q.life <= 0) {
        slot = q;
        break;
      }
    }
    if (!slot) return;
    const h = idHash(`petal:${Math.floor(simT * 10)}`);
    slot.x = (h - 0.5) * 1.8;
    slot.y = 0.04;
    slot.z = (idHash("pz") - 0.5) * 1.5;
    slot.kind = PARTICLE_KIND_PETAL;
    slot.life = 5.5;
  }

  private stepKoi(simT: number, dt: number, slotted: VizTalkerSample[]): void {
    const school = this.opts.schooling;
    const wander = 1 - school;
    const speedMul = this.opts.swimSpeed * (this.opts.reducedMotion ? 0.45 : 1);
    const slottedSet = new Set(slotted.map((t) => t.id));
    for (const k of this.koi.values()) {
      if (!slottedSet.has(k.id)) continue;
      const pad = this.pads[k.padIndex % this.pads.length];
      const targetX = pad ? pad.x : 0;
      const targetZ = pad ? pad.z : 0;
      const orbit = school * 0.22;
      const tx = targetX + Math.sin(simT * 0.8 + idHash(k.id) * 8) * orbit;
      const tz = targetZ + Math.cos(simT * 0.75 + idHash(k.id) * 6) * orbit;
      const wx = Math.sin(simT * 0.35 + idHash(k.id) * 4) * wander * 0.35;
      const wz = Math.cos(simT * 0.32 + idHash(k.id) * 3) * wander * 0.35;
      const ax = (tx + wx - k.x) * (0.9 + k.vigor) * dt;
      const az = (tz + wz - k.z) * (0.9 + k.vigor) * dt;
      k.vx = k.vx * 0.9 + ax;
      k.vz = k.vz * 0.9 + az;
      const spd = Math.hypot(k.vx, k.vz);
      const maxSpd = (0.28 + k.vigor * 0.35) * speedMul;
      if (spd > maxSpd && spd > 0) {
        const s = maxSpd / spd;
        k.vx *= s;
        k.vz *= s;
      }
      k.x = clamp(k.x + k.vx, -1.35, 1.35);
      k.z = clamp(k.z + k.vz, -1.25, 1.25);
      k.yaw = Math.atan2(k.vx, k.vz + 0.001);
      if (pad) {
        pad.activity = clamp01(pad.activity + k.vigor * 0.02);
        if (this.opts.bloomOnActivity) {
          pad.bloom = clamp01(pad.bloom + k.vigor * 0.04);
        }
      }
    }
    for (const pad of this.pads) {
      pad.activity *= 0.96;
      if (!this.opts.bloomOnActivity) pad.bloom = 0.2;
      else pad.bloom = clamp01(pad.bloom * 0.985 + pad.activity * 0.02);
    }
  }

  private stepOnce(simT: number, allTalkers: VizTalkerSample[]): void {
    const allIds = new Set(allTalkers.map((t) => t.id));
    const slotted = this.slottedTalkers(allTalkers, simT);
    this.syncKoi(slotted, allIds, allTalkers);
    this.stepKoi(simT, FIXED_SIM_DT, slotted);
    const motion = this.opts.reducedMotion || !this.opts.cameraDrift;
    const camRate = motion ? 0 : 0.28;
    this.camPhase += FIXED_SIM_DT * camRate;
    this.spawnPetals(simT);
    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= FIXED_SIM_DT;
        if (p.kind >= PARTICLE_KIND_PETAL) {
          p.x += Math.sin(simT * 1.2 + p.z) * 0.03 * FIXED_SIM_DT;
          p.z += 0.04 * FIXED_SIM_DT;
        } else {
          p.y += 0.02 * FIXED_SIM_DT;
        }
      }
    }
    let activeParticles = 0;
    for (const p of this.particles) if (p.life > 0) activeParticles++;
    const q = QUALITY_CAPS[this.opts.quality];
    this.lastWork = {
      koi: this.koi.size,
      particles: activeParticles,
      raymarchSteps: q.steps,
    };
    if (!this.warmed) this.warmed = true;
  }

  step(frame: KoiPondFrame): void {
    const talkers =
      frame.demo && frame.talkers.length === 0
        ? this.spawnDemoTalkers(frame.t)
        : frame.talkers;
    this.ingestPackets(frame.packets);
    this.simAccumulator += Math.min(0.1, frame.dt || FIXED_SIM_DT);
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
    const failed = clamp01(this.lastSys?.failed ?? 0);
    const murk =
      failed > FAIL_MURK_THRESHOLD
        ? clamp01((failed - FAIL_MURK_THRESHOLD) / 0.42)
        : 0;
    const failBanner = murk > 0.05 ? 1 : 0;
    const s0 = this.slot0;
    s0.fill(0);
    s0[KOI_SLOT.waterTint] = o.waterTint;
    s0[KOI_SLOT.clarity] = o.waterClarity * (1 - murk * 0.5);
    s0[KOI_SLOT.murk] = murk;
    s0[KOI_SLOT.failBanner] = failBanner;
    s0[KOI_SLOT.schooling] = o.schooling;
    s0[KOI_SLOT.swimSpeed] = o.swimSpeed;
    s0[KOI_SLOT.lilyDensity] = o.lilyDensity;
    s0[KOI_SLOT.lotusCount] = o.lotusCount;
    s0[KOI_SLOT.lotusColour] =
      o.lotusColour === "pink" ? 0 : o.lotusColour === "white" ? 1 : 0.5;
    s0[KOI_SLOT.bloomOn] = o.bloomOnActivity ? 1 : 0;
    s0[KOI_SLOT.ripple] = o.rippleIntensity;
    s0[KOI_SLOT.causticsOn] = o.caustics ? 1 : 0;
    s0[KOI_SLOT.causticStrength] = o.causticStrength;
    s0[KOI_SLOT.petalsOn] = o.petalDrift ? 1 : 0;
    s0[KOI_SLOT.dragonfliesOn] = o.dragonflies ? 1 : 0;
    const tod =
      o.timeOfDay === "dawn"
        ? 0.15
        : o.timeOfDay === "dusk"
          ? 0.65
          : o.timeOfDay === "night"
            ? 0.92
            : 0.35;
    s0[KOI_SLOT.timeOfDay] = tod;
    s0[KOI_SLOT.rainOn] = o.rain ? 1 : 0;
    s0[KOI_SLOT.cameraAngle] = o.cameraAngle === "top" ? 0 : 1;
    s0[KOI_SLOT.camPhase] = this.camPhase;
    s0[KOI_SLOT.canvasW] = canvasW;
    s0[KOI_SLOT.canvasH] = canvasH;
    s0[KOI_SLOT.labelOn] = o.label ? 1 : 0;
    s0[KOI_SLOT.legendOn] = o.legend ? 1 : 0;
    s0[KOI_SLOT.seedFrac] = (o.seed % 1000) / 1000;
    const packedIds = slottedTalkerIds(this.talkerSlots);
    s0[KOI_SLOT.koiCount] = packedIds.length;
    s0[KOI_SLOT.demo] = this.lastDemo ? 1 : 0;
    s0[KOI_SLOT.timeScale] = o.reducedMotion ? 0.15 : 1;
    let peak = 0;
    for (const t of this.lastTalkers) peak = Math.max(peak, t.rate);
    s0[KOI_SLOT.metricPeak] = clamp01(peak / 220);
    const q = QUALITY_CAPS[o.quality];
    s0[KOI_SLOT.raymarchSteps] = q.steps;
    s0[KOI_SLOT.tileResScale] = tileInternalResScale(canvasW, canvasH);
    s0[KOI_SLOT.sizeScale] = o.koiSize;
    s0[KOI_SLOT.varietyMix] = o.varietyMix;
    const failedVis = clamp01(this.lastSys?.failed ?? 0);
    const labelMetric = !o.label
      ? 0
      : this.lastDemo
        ? 2
        : failedVis > FAIL_MURK_THRESHOLD
          ? 3
          : this.lastTalkers.length
            ? 1
            : 0;
    s0[KOI_SLOT.labelMetric] = labelMetric;
    let legendMask = 0;
    for (let i = 0; i < Math.min(6, o.patternFlags.length); i++) {
      if (o.patternFlags[i]) legendMask |= 1 << i;
    }
    s0[KOI_SLOT.patternLegend] = legendMask;
    for (let i = 0; i < KOI_ATTR_SLOTS; i++) {
      s0[KOI_SLOT.koiPattern0 + i] = 0;
      s0[KOI_SLOT.koiVigor0 + i] = 0;
    }
    let ki = 0;
    for (const id of packedIds) {
      if (ki >= KOI_ATTR_SLOTS) break;
      const k = this.koi.get(id);
      if (!k) continue;
      s0[KOI_SLOT.koiPattern0 + ki] = k.pattern;
      s0[KOI_SLOT.koiVigor0 + ki] = k.vigor;
      ki++;
    }

    const s1 = this.slot1;
    s1.fill(0);
    let fi = 0;
    for (const id of packedIds) {
      if (fi >= MAX_KOI * 4) break;
      const k = this.koi.get(id);
      if (!k) continue;
      s1[fi++] = k.x;
      s1[fi++] = 0;
      s1[fi++] = k.z;
      s1[fi++] = k.yaw;
    }

    const s2 = this.slot2;
    s2.fill(0);
    let pi = 0;
    let pCount = 0;
    const scratch = this.particleScratch;
    scratch.fill(0);
    for (let i = 0; i < Math.min(PAD_SLOTS, this.pads.length); i++) {
      const pad = this.pads[i]!;
      const base = i * 4;
      s2[base] = pad.x;
      s2[base + 1] = pad.bloom;
      s2[base + 2] = pad.z;
      s2[base + 3] = pad.activity;
    }
    const particleBase = PAD_SLOTS * 4;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      if (particleBase + pi >= 64) break;
      s2[particleBase + pi++] = p.x;
      s2[particleBase + pi++] = p.y;
      s2[particleBase + pi++] = p.z;
      s2[particleBase + pi++] = p.kind;
      const j = pCount * 4;
      scratch[j] = p.x;
      scratch[j + 1] = p.y;
      scratch[j + 2] = p.z;
      scratch[j + 3] = p.kind;
      pCount++;
    }
    s0[KOI_SLOT.particleCount] = pCount;

    const metric = this.lastDemo
      ? "demo"
      : liveMetricLabel(this.lastTalkers, this.lastSys);
    const label = koiPondHudLabel(o, this.lastDemo, metric);
    const accent: [number, number, number] = [0.95, 0.55, 0.35];
    const bg: [number, number, number] = [
      0.02 + o.waterTint * 0.04,
      0.12 + o.waterTint * 0.08,
      0.18 + o.waterTint * 0.12,
    ];
    const bright = 0.7 + this.lastAudio * 0.22 - murk * 0.22;
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
  private lastAudio = 0;
  private lastTalkers: VizTalkerSample[] = [];

  advance(frame: KoiPondFrame, canvasW = 1280, canvasH = 800): ReturnType<KoiPondSim["pack"]> {
    this.lastSys = frame.sys;
    this.lastDemo = !!frame.demo;
    this.lastAudio = frame.audio;
    this.lastTalkers = frame.talkers;
    this.step(frame);
    return this.pack(canvasW, canvasH);
  }
}

export function failureVisuals(sys?: { failed?: number }): { murk: number; banner: number } {
  const failed = clamp01(sys?.failed ?? 0);
  const murk =
    failed > FAIL_MURK_THRESHOLD ? clamp01((failed - FAIL_MURK_THRESHOLD) / 0.5) : 0;
  return { murk, banner: murk > 0.05 ? 1 : 0 };
}

export function koiPondSmokeLuma(packed: ReturnType<KoiPondSim["pack"]>): number {
  const base = packed.bright * (0.4 + packed.slot0[KOI_SLOT.clarity]! * 0.35);
  const koiGlow = Math.min(0.3, packed.slot0[KOI_SLOT.koiCount]! * 0.025);
  return clamp01(base + koiGlow - packed.murk * 0.35);
}

export function assertWorkBudgetUnderCaps(
  work: { koi: number; particles: number; raymarchSteps: number },
  quality: QualityLevel,
): boolean {
  const cap = QUALITY_CAPS[quality];
  return (
    work.koi <= cap.maxKoi
    && work.koi <= MAX_KOI
    && work.particles <= cap.maxParticles
    && work.particles <= MAX_PARTICLES
    && work.raymarchSteps <= KOI_WORK_BUDGET.raymarchSteps
  );
}

export function demoFrame(t = 1): KoiPondFrame {
  const talkers: VizTalkerSample[] = [];
  for (let i = 0; i < 5; i++) {
    talkers.push({
      id: `demo-host:${i}`,
      rate: 80 + i * 20,
      role: i === 0 ? "gateway" : "lan",
    });
  }
  return {
    t,
    dt: 1 / 60,
    audio: 0.12,
    talkers,
    packets: [
      { proto: "TCP", size: 120, field: 0.45 },
      { proto: "UDP", size: 64, field: 0.3 },
    ],
    demo: true,
  };
}
