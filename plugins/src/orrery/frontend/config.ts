/** View options — every knob comes from visualisation.yml config via config.read. */

export const ORRERY_DATA_MAPPING = [
  { field: "talkers[].id", effect: "stable planet slot per talker (rate-ranked, 2 s hold, 1.2x challenger)", default: "—", clamp: "planetCap arms" },
  { field: "talkers[].rate", effect: "orbit speed of that talker's planet", default: 0, clamp: "log1p(rate)/log1p(400)" },
  { field: "talkers[].rate x packets[].size", effect: "planet size from estimated byte volume (20 s average)", default: 0, clamp: "12-24 mm, log10 bytes/s" },
  { field: "talkers[].role", effect: "planet surface (gateway ringed, self banded, others by id hash)", default: "lan", clamp: "7 planet maps" },
  { field: "packets[].proto", effect: "spark colour along the gear train", default: "tcp", clamp: "hash01 into amber-gold" },
  { field: "packets[]", effect: "one spark per packet from the escape wheel to a planet", default: 0, clamp: "maxPacketsPerFrame, sparkCap pool" },
  { field: "sys.failed", effect: "escapement slows to an uneven tick and a steady fail plaque lights", default: 0, clamp: "0..1 above failThreshold" },
  { field: "audio", effect: "sun glow and lamp warmth breathe", default: 0, clamp: "0..1" },
] as const;

export type OrreryPreset = "study" | "night-watch" | "clockmaker" | "grand";
export type CameraMode = "drift" | "fixed" | "low" | "top";
export type ReducedMotion = "auto" | "on" | "off";

export interface OrreryOptions {
  preset: OrreryPreset;
  planetCap: number;
  orbitSpeed: number;
  planetScale: number;
  tickRate: number;
  sparks: boolean;
  sparkCap: number;
  failThreshold: number;
  cameraMode: CameraMode;
  lampWarmth: number;
  reducedMotion: ReducedMotion;
}

export const ORRERY_DEFAULTS: OrreryOptions = {
  preset: "study",
  planetCap: 7,
  orbitSpeed: 1,
  planetScale: 1,
  tickRate: 1,
  sparks: true,
  sparkCap: 24,
  failThreshold: 0.2,
  cameraMode: "drift",
  lampWarmth: 0.7,
  reducedMotion: "auto",
};

export const PRESETS: readonly OrreryPreset[] = ["study", "night-watch", "clockmaker", "grand"];

const PRESET_PATCH: Record<OrreryPreset, Partial<OrreryOptions>> = {
  study: {},
  "night-watch": { lampWarmth: 0.35, cameraMode: "low", orbitSpeed: 0.75, tickRate: 0.8 },
  clockmaker: { cameraMode: "top", tickRate: 1.25, sparkCap: 32, lampWarmth: 0.85 },
  grand: { planetCap: 8, planetScale: 1.15, orbitSpeed: 1.2, cameraMode: "drift" },
};

function num(raw: string | undefined, def: number, lo: number, hi: number): number {
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function sel<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return def;
}

function bool(raw: string | undefined, def: boolean): boolean {
  if (raw === "true" || raw === "1" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return def;
}

function atDefault(raw: string, def: unknown): boolean {
  if (typeof def === "number") return Number(raw) === def;
  if (typeof def === "boolean") return bool(raw, !def) === def;
  return raw === def;
}

/**
 * Preset first, then any knob the user set explicitly (all config.read values are strings). The
 * host sends every knob, defaults included, so a knob still at its default yields to the preset.
 */
export function parseOrreryOptions(input: Record<string, string | undefined> = {}, maxInstances = 48): OrreryOptions {
  const preset = sel(input.preset, PRESETS, ORRERY_DEFAULTS.preset);
  const patch: Partial<OrreryOptions> = PRESET_PATCH[preset];
  const raw = { ...input };
  for (const key of Object.keys(patch) as (keyof OrreryOptions)[]) {
    const v = raw[key];
    if (v !== undefined && atDefault(v, ORRERY_DEFAULTS[key])) delete raw[key];
  }
  const p = { ...ORRERY_DEFAULTS, ...patch };
  const planetCap = Math.round(num(raw.planetCap, p.planetCap, 1, 8));
  // arms and planets take 2 instances each; whatever is left of the cap is the spark pool
  const sparkRoom = Math.max(0, Math.min(32, maxInstances - 2 * planetCap));
  return {
    preset,
    planetCap,
    orbitSpeed: num(raw.orbitSpeed, p.orbitSpeed, 0.25, 2),
    planetScale: num(raw.planetScale, p.planetScale, 0.6, 1.4),
    tickRate: num(raw.tickRate, p.tickRate, 0.5, 2),
    sparks: bool(raw.sparks, p.sparks),
    sparkCap: Math.round(num(raw.sparkCap, Math.min(p.sparkCap, sparkRoom), 0, sparkRoom)),
    failThreshold: num(raw.failThreshold, p.failThreshold, 0.05, 0.95),
    cameraMode: sel(raw.cameraMode, ["drift", "fixed", "low", "top"] as const, p.cameraMode),
    lampWarmth: num(raw.lampWarmth, p.lampWarmth, 0, 1),
    reducedMotion: sel(raw.reducedMotion, ["auto", "on", "off"] as const, p.reducedMotion),
  };
}

/** Zoto Fail — the steady plaque colour and the failed-spark hue. */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
