import { VOX_CONFIG_KEYS } from "./config-manifest";

export type VoxPreset = "classic" | "snowy" | "desert" | "night" | "archipelago" | "custom";
export type VoxBiome = "temperate" | "boreal" | "arid" | "islands";
export type VoxWeather = "clear" | "rain" | "snow";
export type VoxCamera = "fly" | "walk" | "orbit";
export type VoxTextureStyle = "crisp" | "smooth" | "painterly";
export type VoxPalette = "verdant" | "sunset" | "alpine" | "candy";

export interface VoxCaps {
  maxChunks: number;
  maxViewDist: number;
  vertexBudget: number;
  maxMobs: number;
  chunksPerFrame: number;
}

export interface VoxLiveBindings {
  sysLoadWeather: number;
  eventRateCloud: number;
  packetFieldTorch: number;
  packetFieldBlock: number;
  sysFailedFailBeacon: number;
}

export interface VoxOptions {
  preset: VoxPreset;
  seed: number;
  biome: VoxBiome;
  viewDist: number;
  timeOfDay: number;
  cycleSpeed: number;
  weather: VoxWeather;
  camera: VoxCamera;
  cameraSpeed: number;
  fog: number;
  textureStyle: VoxTextureStyle;
  mobs: number;
  clouds: boolean;
  palette: VoxPalette;
  reducedMotion: boolean;
  caps: VoxCaps;
  live: VoxLiveBindings;
}

const PRESETS: Record<Exclude<VoxPreset, "custom">, Partial<VoxOptions>> = {
  classic: {
    preset: "classic", seed: 4242, biome: "temperate", viewDist: 40, timeOfDay: 14, cycleSpeed: 0.35,
    weather: "clear", camera: "fly", cameraSpeed: 1, fog: 0.5, textureStyle: "crisp", mobs: 3, clouds: true, palette: "verdant",
  },
  snowy: {
    preset: "snowy", seed: 9001, biome: "boreal", viewDist: 44, timeOfDay: 10, cycleSpeed: 0.15,
    weather: "snow", camera: "walk", cameraSpeed: 0.85, fog: 0.72, textureStyle: "smooth", mobs: 2, clouds: true, palette: "alpine",
  },
  desert: {
    preset: "desert", seed: 1337, biome: "arid", viewDist: 48, timeOfDay: 17, cycleSpeed: 0.2,
    weather: "clear", camera: "fly", cameraSpeed: 1.1, fog: 0.35, textureStyle: "painterly", mobs: 1, clouds: false, palette: "sunset",
  },
  night: {
    preset: "night", seed: 2048, biome: "temperate", viewDist: 36, timeOfDay: 22.5, cycleSpeed: 0,
    weather: "clear", camera: "orbit", cameraSpeed: 0.7, fog: 0.6, textureStyle: "crisp", mobs: 0, clouds: true, palette: "verdant",
  },
  archipelago: {
    preset: "archipelago", seed: 7777, biome: "islands", viewDist: 42, timeOfDay: 15.5, cycleSpeed: 0.25,
    weather: "rain", camera: "orbit", cameraSpeed: 0.95, fog: 0.48, textureStyle: "smooth", mobs: 4, clouds: true, palette: "candy",
  },
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function num(raw: string | undefined, def: number, lo: number, hi: number): number {
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? clamp(v, lo, hi) : def;
}

function bool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined || raw === "") return def;
  return raw === "true" || raw === "1" || raw === "on";
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return def;
}

function capsFrom(cfg: Record<string, string>): VoxCaps {
  return {
    maxChunks: Math.round(num(cfg.cap_maxChunks, 8, 8, 8)),
    maxViewDist: Math.round(num(cfg.cap_maxViewDist, 48, 48, 48)),
    vertexBudget: Math.round(num(cfg.cap_vertexBudget, 65536, 65536, 65536)),
    maxMobs: Math.round(num(cfg.cap_maxMobs, 6, 6, 6)),
    chunksPerFrame: Math.round(num(cfg.cap_chunksPerFrame, 2, 1, 2)),
  };
}

function liveFrom(cfg: Record<string, string>): VoxLiveBindings {
  return {
    sysLoadWeather: num(cfg.bind_sysLoad_weather, 0.35, 0, 1),
    eventRateCloud: num(cfg.bind_eventRate_cloudCover, 0.4, 0, 1),
    packetFieldTorch: num(cfg.bind_packetField_torch, 0.85, 0, 1),
    packetFieldBlock: num(cfg.bind_packetField_block, 0.7, 0, 1),
    sysFailedFailBeacon: num(cfg.bind_sysFailed_failBeacon, 1, 0, 1),
  };
}

/** Parse only plugin.yml config keys delivered by the host (config.read). */
export function parseVoxConfig(cfg: Record<string, string> = {}): VoxOptions {
  const filtered: Record<string, string> = {};
  for (const k of VOX_CONFIG_KEYS) if (cfg[k] !== undefined) filtered[k] = cfg[k]!;
  const preset = pick(filtered.preset, ["classic", "snowy", "desert", "night", "archipelago", "custom"] as const, "classic");
  const base = preset === "custom"
    ? { preset: "custom" as const, seed: 4242, biome: "temperate" as const, viewDist: 40, timeOfDay: 14, cycleSpeed: 0,
      weather: "clear" as const, camera: "fly" as const, cameraSpeed: 1, fog: 0.55, textureStyle: "crisp" as const,
      mobs: 3, clouds: true, palette: "verdant" as const, reducedMotion: false }
    : { ...PRESETS[preset], reducedMotion: false };
  const caps = capsFrom(filtered);
  const maxV = caps.maxViewDist;
  return {
    preset,
    seed: Math.round(num(filtered.seed, base.seed!, 1, 999_999)),
    biome: pick(filtered.biome, ["temperate", "boreal", "arid", "islands"] as const, base.biome!),
    viewDist: Math.round(num(filtered.viewDist, base.viewDist!, 16, maxV)),
    timeOfDay: num(filtered.timeOfDay, base.timeOfDay!, 0, 24),
    cycleSpeed: num(filtered.cycleSpeed, base.cycleSpeed!, 0, 4),
    weather: pick(filtered.weather, ["clear", "rain", "snow"] as const, base.weather!),
    camera: pick(filtered.camera, ["fly", "walk", "orbit"] as const, base.camera!),
    cameraSpeed: num(filtered.cameraSpeed, base.cameraSpeed!, 0.2, 2.5),
    fog: num(filtered.fog, base.fog!, 0, 1),
    textureStyle: pick(filtered.textureStyle, ["crisp", "smooth", "painterly"] as const, base.textureStyle!),
    mobs: Math.round(num(filtered.mobs, base.mobs!, 0, caps.maxMobs)),
    clouds: bool(filtered.clouds, base.clouds!),
    palette: pick(filtered.palette, ["verdant", "sunset", "alpine", "candy"] as const, base.palette!),
    reducedMotion: bool(filtered.reducedMotion, base.reducedMotion ?? false),
    caps,
    live: liveFrom(filtered),
  };
}

export function voxRenderScale(): number {
  return 1.0;
}
