/** View config for the fluid-dynamics tank. Sliders at 0.5 keep the character's recipe. */

export const FLUID_CHARACTERS = [
  "ink",
  "smoke",
  "vortex",
  "river",
  "lava",
  "storm",
  "oil",
  "kelvin",
] as const;
export type FluidCharacter = (typeof FLUID_CHARACTERS)[number];

export const FLUID_SHADES = ["dye", "speed", "vorticity", "stream", "mix"] as const;
export type FluidShade = (typeof FLUID_SHADES)[number];

export const FLUID_PALETTES = ["ink", "ocean", "magma", "thermal", "neon", "mono"] as const;
export type FluidPalette = (typeof FLUID_PALETTES)[number];

export const FLUID_DOMAINS = ["slab", "tank"] as const;
export type FluidDomain = (typeof FLUID_DOMAINS)[number];

export const FLUID_AUDIO = ["off", "stir", "kick"] as const;
export type FluidAudio = (typeof FLUID_AUDIO)[number];

export const FLUID_EMITTERS = ["recipe", "one", "two", "three"] as const;
export type FluidEmitters = (typeof FLUID_EMITTERS)[number];

export interface FluidOptions {
  character: FluidCharacter;
  viscosity: number;
  diffusion: number;
  dissipation: number;
  vorticity: number;
  iterations: number;
  speed: number;
  paused: boolean;
  gravity: number;
  wind: number;
  swirl: number;
  stirrer: number;
  emitRate: number;
  emitSize: number;
  emitters: FluidEmitters;
  hue: number;
  hueSpread: number;
  obstacle: number;
  shade: FluidShade;
  palette: FluidPalette;
  glow: number;
  foam: number;
  streamSteps: number;
  detail: number;
  gamma: number;
  domain: FluidDomain;
  vectors: boolean;
  audioMode: FluidAudio;
  trafficStir: boolean;
  clear: "hold" | "go";
  reducedMotion: boolean;
}

function num(o: Record<string, string | undefined>, key: string, def: number, lo: number, hi: number): number {
  const raw = o[key];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, v));
}

function bool(o: Record<string, string | undefined>, key: string, def: boolean): boolean {
  const raw = o[key];
  if (raw === undefined || raw === "") return def;
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

function pick<T extends string>(o: Record<string, string | undefined>, key: string, allowed: readonly T[], def: T): T {
  const raw = o[key];
  if (!raw) return def;
  return (allowed as readonly string[]).includes(raw) ? raw as T : def;
}

function reducedMotion(env?: { reducedMotion?: boolean }): boolean {
  if (env?.reducedMotion !== undefined) return env.reducedMotion;
  const media = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  if (!media) return false;
  try {
    return media("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function parseFluidOptions(
  raw: Record<string, string | undefined> | undefined,
  env?: { reducedMotion?: boolean },
): FluidOptions {
  const o = raw ?? {};
  return {
    character: pick(o, "character", FLUID_CHARACTERS, "ink"),
    viscosity: num(o, "viscosity", 0.5, 0, 1),
    diffusion: num(o, "diffusion", 0.5, 0, 1),
    dissipation: num(o, "dissipation", 0.5, 0, 1),
    vorticity: num(o, "vorticity", 0.5, 0, 1),
    iterations: Math.round(num(o, "iterations", 8, 4, 16)),
    speed: num(o, "speed", 0.55, 0, 1.5),
    paused: bool(o, "paused", false),
    gravity: num(o, "gravity", 0.5, 0, 1),
    wind: num(o, "wind", 0.5, 0, 1),
    swirl: num(o, "swirl", 0.5, 0, 1),
    stirrer: num(o, "stirrer", 0.5, 0, 1),
    emitRate: num(o, "emitRate", 0.5, 0, 1),
    emitSize: num(o, "emitSize", 0.5, 0, 1),
    emitters: pick(o, "emitters", FLUID_EMITTERS, "recipe"),
    hue: num(o, "hue", 0, 0, 1),
    hueSpread: num(o, "hueSpread", 0.5, 0, 1),
    obstacle: num(o, "obstacle", 0.5, 0, 1),
    shade: pick(o, "shade", FLUID_SHADES, "dye"),
    palette: pick(o, "palette", FLUID_PALETTES, "ink"),
    glow: num(o, "glow", 0.35, 0, 1),
    foam: num(o, "foam", 0.35, 0, 1),
    streamSteps: Math.round(num(o, "streamSteps", 8, 2, 16)),
    detail: num(o, "detail", 0.35, 0, 1),
    gamma: num(o, "gamma", 0.85, 0.35, 2.2),
    domain: pick(o, "domain", FLUID_DOMAINS, "slab"),
    vectors: bool(o, "vectors", false),
    audioMode: pick(o, "audioMode", FLUID_AUDIO, "off"),
    trafficStir: bool(o, "trafficStir", false),
    clear: o.clear === "go" ? "go" : "hold",
    reducedMotion: reducedMotion(env),
  };
}
