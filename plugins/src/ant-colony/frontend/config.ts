/** Ant Colony view options — every knob comes from visualisation.yml via config.read. */

export type AntPreset = "formicarium" | "night-glow" | "red-alert" | "minimal";
export type AntPalette = "loam" | "clay" | "chalk" | "mono";
export type AntSoil = "strata" | "sand" | "rocky";
export type AntCamera = "cutaway" | "pan" | "follow";

export interface AntColonyLook {
  preset: AntPreset;
  seed: number;
  antCap: number;
  evaporation: number;
  diffusion: number;
  palette: AntPalette;
  soilStyle: AntSoil;
  camera: AntCamera;
  rain: boolean;
  label: string;
  mapFlows: boolean;
  mapBytes: boolean;
  mapRate: boolean;
  mapFailures: boolean;
  reducedMotion: boolean;
}

export const ANT_DEFAULTS: AntColonyLook = {
  preset: "formicarium",
  seed: 4242,
  antCap: 96,
  evaporation: 0.92,
  diffusion: 0.22,
  palette: "loam",
  soilStyle: "strata",
  camera: "cutaway",
  rain: false,
  label: "",
  mapFlows: true,
  mapBytes: true,
  mapRate: true,
  mapFailures: true,
  reducedMotion: false,
};

const PRESET_PATCH: Record<AntPreset, Partial<AntColonyLook>> = {
  formicarium: { palette: "loam", soilStyle: "strata", evaporation: 0.92, diffusion: 0.22, antCap: 96 },
  "night-glow": { palette: "chalk", soilStyle: "strata", evaporation: 0.95, diffusion: 0.28, antCap: 112, rain: false },
  "red-alert": { palette: "clay", soilStyle: "rocky", evaporation: 0.88, diffusion: 0.18, antCap: 128, rain: false },
  minimal: { palette: "mono", soilStyle: "sand", evaporation: 0.9, diffusion: 0.12, antCap: 48, rain: false },
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === "") return def;
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  return def;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (!raw) return def;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

export function parseAntColonyLook(cfg?: Record<string, string>): AntColonyLook {
  const base = { ...ANT_DEFAULTS };
  const preset = pick(cfg?.preset, ["formicarium", "night-glow", "red-alert", "minimal"] as const, base.preset);
  Object.assign(base, PRESET_PATCH[preset]);
  base.preset = preset;
  base.seed = clamp(Math.round(Number(cfg?.seed) || base.seed), 0, 999_999);
  base.antCap = clamp(Math.round(Number(cfg?.antCap) || base.antCap), 24, 160);
  base.evaporation = clamp(Number(cfg?.evaporation) || base.evaporation, 0.8, 0.99);
  base.diffusion = clamp(Number(cfg?.diffusion) || base.diffusion, 0.05, 0.45);
  base.palette = pick(cfg?.palette, ["loam", "clay", "chalk", "mono"] as const, base.palette);
  base.soilStyle = pick(cfg?.soilStyle, ["strata", "sand", "rocky"] as const, base.soilStyle);
  base.camera = pick(cfg?.camera, ["cutaway", "pan", "follow"] as const, base.camera);
  base.rain = parseBool(cfg?.rain, base.rain);
  base.label = (cfg?.label ?? base.label).slice(0, 48);
  base.mapFlows = parseBool(cfg?.mapFlows, base.mapFlows);
  base.mapBytes = parseBool(cfg?.mapBytes, base.mapBytes);
  base.mapRate = parseBool(cfg?.mapRate, base.mapRate);
  base.mapFailures = parseBool(cfg?.mapFailures, base.mapFailures);
  base.reducedMotion = parseBool(cfg?.reducedMotion, false);
  return base;
}

/** Data-to-effect mapping declared for QE (mirrors visualisation.yml hints). */
export const ANT_DATA_MAPPING = [
  { field: "packets[] / flows", effect: "tunnel dig + foraging polylines", default: "on", clamp: "mapFlows boolean" },
  { field: "packet.size", effect: "crumb radius", default: "on", clamp: "mapBytes boolean" },
  { field: "talker.rate", effect: "ant speed & spawn density", default: "on", clamp: "mapRate boolean" },
  { field: "sys.failed", effect: "colony-wide soldier pour + fail label (machine gauge)", default: "on", clamp: "mapFailures boolean" },
] as const;

/** Per-frame work budget (counts only — for light tests / caps). */
export const ANT_WORK_BUDGET = {
  drawCalls: 1,
  triangles: 0,
  particles: 0,
  instances: 160,
  gpuBytes: 2048,
} as const;
