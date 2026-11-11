/** View options — every knob comes from visualisation.yml config via config.read. */

export const BONSAI_DATA_MAPPING = [
  { field: "talkers[].rate", effect: "leaf density across the pads follows the number of active talkers", default: 0, clamp: "active above 0.05/s, log scale to densityTalkers" },
  { field: "packets[]", effect: "a packet burst opens a cluster of blossoms on one pad", default: 0, clamp: "0.6 s rate over 30 s baseline, cooldown, blossomCap pool" },
  { field: "packets[].proto", effect: "blossom tint (pink, blush, white, plum)", default: "tcp", clamp: "hash01 into 4 tints" },
  { field: "sys.failed", effect: "pads turn autumn colour one by one and leaves fall gently to the slab (no flashing)", default: 0, clamp: "0..1 above failThreshold" },
  { field: "clock", effect: "time of day sets the light warmth and the sun height", default: "local time", clamp: "timeOfDay knob overrides" },
  { field: "audio", effect: "a breeze stirs the pads", default: 0, clamp: "0..1" },
] as const;

export type BonsaiPreset = "garden" | "zen" | "spring" | "gallery";
export type CameraMode = "garden" | "close" | "low" | "gallery";
export type TimeOfDay = "auto" | "dawn" | "day" | "golden" | "night";
export type ReducedMotion = "auto" | "on" | "off";

export interface BonsaiOptions {
  preset: BonsaiPreset;
  timeOfDay: TimeOfDay;
  turnMinutes: number;
  densityTalkers: number;
  leafDensity: number;
  blossoms: boolean;
  blossomCap: number;
  fallCap: number;
  failThreshold: number;
  cameraMode: CameraMode;
  breeze: number;
  reducedMotion: ReducedMotion;
}

export const BONSAI_DEFAULTS: BonsaiOptions = {
  preset: "garden",
  timeOfDay: "auto",
  turnMinutes: 4,
  densityTalkers: 12,
  leafDensity: 1,
  blossoms: true,
  blossomCap: 24,
  fallCap: 16,
  failThreshold: 0.2,
  cameraMode: "garden",
  breeze: 0.5,
  reducedMotion: "auto",
};

export const PRESETS: readonly BonsaiPreset[] = ["garden", "zen", "spring", "gallery"];

const PRESET_PATCH: Record<BonsaiPreset, Partial<BonsaiOptions>> = {
  garden: {},
  zen: { turnMinutes: 8, blossomCap: 12, breeze: 0.25, cameraMode: "low" },
  spring: { blossomCap: 32, leafDensity: 1.15, breeze: 0.7, timeOfDay: "day" },
  gallery: { cameraMode: "gallery", timeOfDay: "day", turnMinutes: 3 },
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
export function parseBonsaiOptions(input: Record<string, string | undefined> = {}, maxInstances = 48): BonsaiOptions {
  const preset = sel(input.preset, PRESETS, BONSAI_DEFAULTS.preset);
  const patch: Partial<BonsaiOptions> = PRESET_PATCH[preset];
  const raw = { ...input };
  for (const key of Object.keys(patch) as (keyof BonsaiOptions)[]) {
    const v = raw[key];
    if (v !== undefined && atDefault(v, BONSAI_DEFAULTS[key])) delete raw[key];
  }
  const p = { ...BONSAI_DEFAULTS, ...patch };
  // blossoms and falling leaves share the instance cap; falling leaves keep their pool first
  const fallCap = Math.round(num(raw.fallCap, Math.min(p.fallCap, maxInstances), 0, Math.min(16, maxInstances)));
  const blossomRoom = Math.max(0, Math.min(32, maxInstances - fallCap));
  return {
    preset,
    timeOfDay: sel(raw.timeOfDay, ["auto", "dawn", "day", "golden", "night"] as const, p.timeOfDay),
    turnMinutes: num(raw.turnMinutes, p.turnMinutes, 0, 20),
    densityTalkers: Math.round(num(raw.densityTalkers, p.densityTalkers, 2, 64)),
    leafDensity: num(raw.leafDensity, p.leafDensity, 0.5, 1.3),
    blossoms: bool(raw.blossoms, p.blossoms),
    blossomCap: Math.round(num(raw.blossomCap, Math.min(p.blossomCap, blossomRoom), 0, blossomRoom)),
    fallCap,
    failThreshold: num(raw.failThreshold, p.failThreshold, 0.05, 0.95),
    cameraMode: sel(raw.cameraMode, ["garden", "close", "low", "gallery"] as const, p.cameraMode),
    breeze: num(raw.breeze, p.breeze, 0, 1),
    reducedMotion: sel(raw.reducedMotion, ["auto", "on", "off"] as const, p.reducedMotion),
  };
}

/** Zoto Fail — the steady sky chip colour. */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
