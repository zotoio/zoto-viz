/** View options — every knob comes from visualisation.yml config via config.read. */

export const FJORD_DATA_MAPPING = [
  { field: "headlines[noaa-kp].text", effect: "aurora strength, curtain speed and latitude from the planetary K-index", default: "demo Kp curve", clamp: "Kp 0..9, 8 s ease" },
  { field: "headlines[noaa-kp].summary", effect: "Kp gauge history and 24 h peak", default: "demo history", clamp: "8 three-hour slots" },
  { field: "talkers[].id", effect: "stable cabin per talker (rate-ranked, 2 s hold, 1.2x challenger)", default: "—", clamp: "cabinCap cabins" },
  { field: "talkers[].rate", effect: "cabin window brightness", default: 0, clamp: "log1p(rate)/log1p(400)" },
  { field: "talkers[].role", effect: "window warmth (self amber, gateway pale, others by id hash)", default: "lan", clamp: "0..1" },
  { field: "packets[]", effect: "one light ripple on the water off a lit cabin per packet", default: 0, clamp: "maxPacketsPerFrame, rippleCap pool" },
  { field: "packets[].proto", effect: "ripple tint between window amber and aurora green", default: "tcp", clamp: "hash01" },
  { field: "sys.failed", effect: "a fog bank rolls in from the fjord head and a steady fail chip lights", default: 0, clamp: "0..1 above failThreshold" },
  { field: "audio", effect: "faint shimmer on the curtains' lower edge", default: 0, clamp: "0..1" },
] as const;

export type FjordPreset = "winter-night" | "still-water" | "substorm" | "sea-fog";
export type KpMode = "live" | "demo";
export type CameraMode = "drift" | "fixed" | "low" | "high";
export type ReducedMotion = "auto" | "on" | "off";

export interface FjordOptions {
  preset: FjordPreset;
  source: string;
  kpMode: KpMode;
  auroraGain: number;
  auroraSpeed: number;
  cabinCap: number;
  ripples: boolean;
  rippleCap: number;
  failThreshold: number;
  fogDensity: number;
  moon: number;
  gauge: boolean;
  cameraMode: CameraMode;
  reducedMotion: ReducedMotion;
  /** Preset-only: calm water reflects more (still-water), a haze floor (sea-fog). */
  calmBias: number;
  hazeFloor: number;
}

export const FJORD_DEFAULTS: FjordOptions = {
  preset: "winter-night",
  source: "noaa-kp",
  kpMode: "live",
  auroraGain: 1,
  auroraSpeed: 1,
  cabinCap: 8,
  ripples: true,
  rippleCap: 12,
  failThreshold: 0.2,
  fogDensity: 0.8,
  moon: 0.55,
  gauge: true,
  cameraMode: "drift",
  reducedMotion: "auto",
  calmBias: 0,
  hazeFloor: 0,
};

export const PRESETS: readonly FjordPreset[] = ["winter-night", "still-water", "substorm", "sea-fog"];

const PRESET_PATCH: Record<FjordPreset, Partial<FjordOptions>> = {
  "winter-night": {},
  "still-water": { cameraMode: "low", moon: 0.7, rippleCap: 8, calmBias: 0.25, auroraSpeed: 0.7 },
  substorm: { auroraGain: 1.35, auroraSpeed: 1.4, moon: 0.3, cameraMode: "high" },
  "sea-fog": { moon: 0.75, hazeFloor: 0.22, fogDensity: 0.95, auroraGain: 0.85 },
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
export function parseFjordOptions(input: Record<string, string | undefined> = {}, maxInstances = 48): FjordOptions {
  const preset = sel(input.preset, PRESETS, FJORD_DEFAULTS.preset);
  const patch: Partial<FjordOptions> = PRESET_PATCH[preset];
  const raw = { ...input };
  for (const key of Object.keys(patch) as (keyof FjordOptions)[]) {
    const v = raw[key];
    if (v !== undefined && atDefault(v, FJORD_DEFAULTS[key])) delete raw[key];
  }
  const p = { ...FJORD_DEFAULTS, ...patch };
  // the scenery instances one streak per cabin plus one ring per ripple
  const cabinCap = Math.round(num(raw.cabinCap, p.cabinCap, 1, 8));
  const rippleRoom = Math.max(0, Math.min(16, maxInstances - cabinCap));
  return {
    preset,
    source: (raw.source ?? p.source).trim(),
    kpMode: sel(raw.kpMode, ["live", "demo"] as const, p.kpMode),
    auroraGain: num(raw.auroraGain, p.auroraGain, 0.4, 2),
    auroraSpeed: num(raw.auroraSpeed, p.auroraSpeed, 0.25, 2),
    cabinCap,
    ripples: bool(raw.ripples, p.ripples),
    rippleCap: Math.round(num(raw.rippleCap, Math.min(p.rippleCap, rippleRoom), 0, rippleRoom)),
    failThreshold: num(raw.failThreshold, p.failThreshold, 0.05, 0.95),
    fogDensity: num(raw.fogDensity, p.fogDensity, 0.2, 1),
    moon: num(raw.moon, p.moon, 0, 1),
    gauge: bool(raw.gauge, p.gauge),
    cameraMode: sel(raw.cameraMode, ["drift", "fixed", "low", "high"] as const, p.cameraMode),
    reducedMotion: sel(raw.reducedMotion, ["auto", "on", "off"] as const, p.reducedMotion),
    calmBias: p.calmBias,
    hazeFloor: p.hazeFloor,
  };
}

/** Zoto Fail — the steady fail chip. */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
