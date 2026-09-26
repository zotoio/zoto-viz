/**
 * Voxel World director — camera, options, mob paths, and UBO slots for `sky/fragment.glsl`.
 */

export const VOX_MAX_VIEW = 48;
export const VOX_MAX_MOBS = 6;
export const VOX_MAX_CHUNKS = 8;
export const VOX_MAX_STEPS = 96;
export const VOX_MAX_DRAWS = 64;

/** Slot 0 layout read by the sky shader. */
export const VOX_SLOT = {
  mark: 0,
  camX: 1,
  camY: 2,
  camZ: 3,
  yaw: 4,
  pitch: 5,
  aspect: 6,
  day: 7,
  seed: 8,
  biome: 9,
  viewDist: 10,
  fog: 11,
  weather: 12,
  camMode: 13,
  camSpeed: 14,
  flags: 15,
  sunX: 16,
  sunY: 17,
  sunZ: 18,
  sunPow: 19,
  torch: 20,
  palette: 21,
  texStyle: 22,
  cycle: 23,
  audioPulse: 24,
  reduced: 25,
  villageX: 26,
  villageZ: 27,
  spare: 28,
} as const;

export const VOX_SLOT0_FLOATS = 32;
export const VOX_MOB_FLOATS = 24;
export const VOX_SLOT1_FLOATS = VOX_MOB_FLOATS;

export type VoxBiome = "temperate" | "boreal" | "arid" | "islands";
export type VoxWeather = "clear" | "rain" | "snow";
export type VoxCamera = "fly" | "walk" | "orbit";
export type VoxTextureStyle = "crisp" | "smooth" | "painterly";
export type VoxPalette = "verdant" | "sunset" | "alpine" | "candy";
export type VoxPreset = "classic" | "snowy" | "desert" | "night" | "archipelago" | "custom";

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
}

export const VOX_DEFAULTS: VoxOptions = {
  preset: "classic",
  seed: 4242,
  biome: "temperate",
  viewDist: 40,
  timeOfDay: 14,
  cycleSpeed: 0,
  weather: "clear",
  camera: "fly",
  cameraSpeed: 1,
  fog: 0.55,
  textureStyle: "crisp",
  mobs: 3,
  clouds: true,
  palette: "verdant",
};

export const VOX_PRESETS: Record<Exclude<VoxPreset, "custom">, Partial<VoxOptions>> = {
  classic: {
    preset: "classic",
    seed: 4242,
    biome: "temperate",
    viewDist: 40,
    timeOfDay: 14,
    cycleSpeed: 0.35,
    weather: "clear",
    camera: "fly",
    cameraSpeed: 1,
    fog: 0.5,
    textureStyle: "crisp",
    mobs: 3,
    clouds: true,
    palette: "verdant",
  },
  snowy: {
    preset: "snowy",
    seed: 9001,
    biome: "boreal",
    viewDist: 44,
    timeOfDay: 10,
    cycleSpeed: 0.15,
    weather: "snow",
    camera: "walk",
    cameraSpeed: 0.85,
    fog: 0.72,
    textureStyle: "smooth",
    mobs: 2,
    clouds: true,
    palette: "alpine",
  },
  desert: {
    preset: "desert",
    seed: 1337,
    biome: "arid",
    viewDist: 48,
    timeOfDay: 17,
    cycleSpeed: 0.2,
    weather: "clear",
    camera: "fly",
    cameraSpeed: 1.1,
    fog: 0.35,
    textureStyle: "painterly",
    mobs: 1,
    clouds: false,
    palette: "sunset",
  },
  night: {
    preset: "night",
    seed: 2048,
    biome: "temperate",
    viewDist: 36,
    timeOfDay: 22.5,
    cycleSpeed: 0,
    weather: "clear",
    camera: "orbit",
    cameraSpeed: 0.7,
    fog: 0.6,
    textureStyle: "crisp",
    mobs: 0,
    clouds: true,
    palette: "verdant",
  },
  archipelago: {
    preset: "archipelago",
    seed: 7777,
    biome: "islands",
    viewDist: 42,
    timeOfDay: 15.5,
    cycleSpeed: 0.25,
    weather: "rain",
    camera: "orbit",
    cameraSpeed: 0.95,
    fog: 0.48,
    textureStyle: "smooth",
    mobs: 4,
    clouds: true,
    palette: "candy",
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

/** Apply a bundled preset then parse overrides (preset field still stored). */
export function parseVoxelWorldOptions(o: Record<string, string | undefined> = {}): VoxOptions {
  const preset = pick(o.preset, ["classic", "snowy", "desert", "night", "archipelago", "custom"] as const, VOX_DEFAULTS.preset);
  const base: VoxOptions = preset === "custom"
    ? { ...VOX_DEFAULTS, preset: "custom" }
    : { ...VOX_DEFAULTS, ...VOX_PRESETS[preset], preset };
  return {
    preset,
    seed: Math.round(num(o.seed, base.seed, 1, 999_999)),
    biome: pick(o.biome, ["temperate", "boreal", "arid", "islands"] as const, base.biome),
    viewDist: Math.round(num(o.viewDist, base.viewDist, 16, VOX_MAX_VIEW)),
    timeOfDay: num(o.timeOfDay, base.timeOfDay, 0, 24),
    cycleSpeed: num(o.cycleSpeed, base.cycleSpeed, 0, 4),
    weather: pick(o.weather, ["clear", "rain", "snow"] as const, base.weather),
    camera: pick(o.camera, ["fly", "walk", "orbit"] as const, base.camera),
    cameraSpeed: num(o.cameraSpeed, base.cameraSpeed, 0.2, 2.5),
    fog: num(o.fog, base.fog, 0, 1),
    textureStyle: pick(o.textureStyle, ["crisp", "smooth", "painterly"] as const, base.textureStyle),
    mobs: Math.round(num(o.mobs, base.mobs, 0, VOX_MAX_MOBS)),
    clouds: bool(o.clouds, base.clouds),
    palette: pick(o.palette, ["verdant", "sunset", "alpine", "candy"] as const, base.palette),
  };
}

let opts: VoxOptions = VOX_DEFAULTS;
let undoStack: VoxOptions[] = [];
const UNDO_MAX = 12;

export function setVoxelWorldOptions(o: VoxOptions): void {
  opts = o;
}

export function voxelWorldOptions(): VoxOptions {
  return opts;
}

export function resetVoxelWorldOptions(): VoxOptions {
  opts = { ...VOX_DEFAULTS };
  undoStack = [];
  return opts;
}

export function applyVoxelPreset(name: VoxPreset): VoxOptions {
  if (name === "custom") {
    opts = { ...opts, preset: "custom" };
    return opts;
  }
  opts = { ...VOX_DEFAULTS, ...VOX_PRESETS[name], preset: name };
  return opts;
}

export function randomiseVoxelWorldOptions(rng = Math.random): VoxOptions {
  undoStack.push({ ...opts });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  const biomes: VoxBiome[] = ["temperate", "boreal", "arid", "islands"];
  const cams: VoxCamera[] = ["fly", "walk", "orbit"];
  const weathers: VoxWeather[] = ["clear", "rain", "snow"];
  const pals: VoxPalette[] = ["verdant", "sunset", "alpine", "candy"];
  const tex: VoxTextureStyle[] = ["crisp", "smooth", "painterly"];
  opts = {
    preset: "custom",
    seed: Math.floor(1 + rng() * 999_999),
    biome: biomes[Math.floor(rng() * biomes.length)]!,
    viewDist: Math.round(16 + rng() * (VOX_MAX_VIEW - 16)),
    timeOfDay: rng() * 24,
    cycleSpeed: rng() * 2.5,
    weather: weathers[Math.floor(rng() * weathers.length)]!,
    camera: cams[Math.floor(rng() * cams.length)]!,
    cameraSpeed: 0.4 + rng() * 1.6,
    fog: rng() * 0.85,
    textureStyle: tex[Math.floor(rng() * tex.length)]!,
    mobs: Math.floor(rng() * (VOX_MAX_MOBS + 1)),
    clouds: rng() > 0.25,
    palette: pals[Math.floor(rng() * pals.length)]!,
  };
  return opts;
}

export function undoVoxelWorldOptions(): VoxOptions | null {
  const prev = undoStack.pop();
  if (!prev) return null;
  opts = prev;
  return opts;
}

/** Host render-scale governor hook — fixed 1.0 for now. */
export function voxelRenderScale(): number {
  return 1.0;
}

let gpuAllocs = 0;

/** Counts logical GPU allocations (procedural atlases); host teardown should call releaseVoxelGpu. */
export function trackVoxelGpuAlloc(n = 1): number {
  gpuAllocs += n;
  return gpuAllocs;
}

export function voxelGpuAllocCount(): number {
  return gpuAllocs;
}

export function releaseVoxelGpu(): void {
  gpuAllocs = 0;
}

function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function voxHash(a: number, b: number, c: number): number {
  return mix32((Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0) / 4294967296;
}

function terrainHeight(x: number, z: number, seed: number, biome: VoxBiome): number {
  const s = seed * 0.001;
  const n = Math.sin(x * 0.07 + s) * 0.5 + Math.sin(z * 0.05 + s * 2) * 0.5;
  const f = Math.sin((x + z) * 0.03 + s * 3) * 0.35;
  let h = 6 + (n + f) * 10;
  if (biome === "boreal") h += 4 + Math.sin(x * 0.02) * 3;
  if (biome === "arid") h = 5 + (n + 0.3) * 5;
  if (biome === "islands") {
    const island = Math.exp(-0.0025 * (x * x + z * z));
    h = 2 + island * 14 + f * 2;
  }
  return h;
}

function sunDir(dayFrac: number): [number, number, number] {
  const ang = (dayFrac - 0.25) * Math.PI * 2;
  const y = Math.sin(ang);
  const xz = Math.cos(ang);
  return [xz * 0.65, y, xz * 0.35];
}

function encodeFlags(clouds: boolean, reduced: boolean): number {
  return (clouds ? 1 : 0) | (reduced ? 2 : 0);
}

function paletteId(p: VoxPalette): number {
  return { verdant: 0, sunset: 1, alpine: 2, candy: 3 }[p];
}

function texId(t: VoxTextureStyle): number {
  return { crisp: 0, smooth: 1, painterly: 2 }[t];
}

function weatherId(w: VoxWeather): number {
  return { clear: 0, rain: 1, snow: 2 }[w];
}

function camId(c: VoxCamera): number {
  return { fly: 0, walk: 1, orbit: 2 }[c];
}

function biomeMix(b: VoxBiome): number {
  return { temperate: 0.25, boreal: 0.55, arid: 0.75, islands: 0.45 }[b];
}

export function voxelCamera(t: number, o: VoxOptions, aspect: number, reducedMotion: boolean): {
  x: number; y: number; z: number; yaw: number; pitch: number;
} {
  const speed = reducedMotion ? o.cameraSpeed * 0.15 : o.cameraSpeed;
  const phase = t * speed * 0.12;
  const villageX = 32;
  const villageZ = -18;
  if (o.camera === "orbit") {
    const r = reducedMotion ? 22 : 28 + Math.sin(phase * 0.3) * 4;
    const ang = reducedMotion ? 0.6 : phase * 0.35;
    const x = villageX + Math.cos(ang) * r;
    const z = villageZ + Math.sin(ang) * r;
    const y = terrainHeight(x, z, o.seed, o.biome) + 10 + Math.sin(phase * 0.5) * 2;
    const yaw = Math.atan2(villageX - x, villageZ - z);
    const pitch = -0.18 + Math.sin(phase * 0.2) * 0.04;
    return { x, y, z, yaw, pitch };
  }
  if (o.camera === "walk") {
    const path = phase * 6;
    const x = Math.sin(path * 0.15) * 40 + Math.cos(path * 0.07) * 20;
    const z = path * 2.2 - 30;
    const ground = terrainHeight(x, z, o.seed, o.biome);
    const y = ground + 1.62 + Math.sin(path * 2) * 0.04;
    const yaw = Math.atan2(Math.cos(path * 0.15) * 6, 2.2);
    const pitch = -0.05 + Math.sin(path) * 0.02;
    return { x, y, z, yaw, pitch };
  }
  const x = Math.sin(phase * 0.4) * 55 + Math.sin(phase * 0.11) * 20;
  const z = -phase * 14;
  const y = terrainHeight(x, z, o.seed, o.biome) + 14 + Math.sin(phase * 0.25) * 3;
  const yaw = Math.atan2(-Math.cos(phase * 0.4) * 20, 14);
  const pitch = -0.28 + Math.sin(phase * 0.18) * 0.06;
  return { x, y, z, yaw, pitch };
}

function packMobs(t: number, o: VoxOptions, cam: { x: number; z: number }): number[] {
  const out = new Array(VOX_MOB_FLOATS).fill(0);
  const n = Math.min(VOX_MAX_MOBS, Math.max(0, o.mobs));
  for (let i = 0; i < n; i++) {
    const h = voxHash(o.seed, i + 3, Math.floor(t * 0.5));
    const ang = t * (0.35 + h) + i * 2.1;
    const rad = 6 + h * 8;
    const x = cam.x + Math.cos(ang) * rad;
    const z = cam.z + Math.sin(ang) * rad;
    const y = terrainHeight(x, z, o.seed, o.biome) + 0.6;
    const o4 = i * 4;
    out[o4] = x;
    out[o4 + 1] = y;
    out[o4 + 2] = z;
    out[o4 + 3] = 0.6 + (i % 3) * 0.15;
  }
  return out;
}

export function voxelSlots(
  t: number,
  aspect: number,
  reducedMotion = false,
  audio = 0,
): { slot0: number[]; slot1: number[] } {
  const o = opts;
  const dayHours = (o.timeOfDay + (o.cycleSpeed / 60) * t) % 24;
  const dayFrac = dayHours / 24;
  const cam = voxelCamera(t, o, aspect, reducedMotion);
  const [sx, sy, sz] = sunDir(dayFrac);
  const sunPow = clamp(sy * 0.85 + 0.15, 0.05, 1);
  const torch = dayFrac < 0.28 || dayFrac > 0.72 ? 0.85 : 0.08;
  const slot0 = new Array(VOX_SLOT0_FLOATS).fill(0);
  slot0[VOX_SLOT.mark] = 1;
  slot0[VOX_SLOT.camX] = cam.x;
  slot0[VOX_SLOT.camY] = cam.y;
  slot0[VOX_SLOT.camZ] = cam.z;
  slot0[VOX_SLOT.yaw] = cam.yaw;
  slot0[VOX_SLOT.pitch] = cam.pitch;
  slot0[VOX_SLOT.aspect] = aspect;
  slot0[VOX_SLOT.day] = dayFrac;
  slot0[VOX_SLOT.seed] = o.seed;
  slot0[VOX_SLOT.biome] = biomeMix(o.biome);
  slot0[VOX_SLOT.viewDist] = o.viewDist;
  slot0[VOX_SLOT.fog] = o.fog;
  slot0[VOX_SLOT.weather] = weatherId(o.weather);
  slot0[VOX_SLOT.camMode] = camId(o.camera);
  slot0[VOX_SLOT.camSpeed] = o.cameraSpeed;
  slot0[VOX_SLOT.flags] = encodeFlags(o.clouds, reducedMotion);
  slot0[VOX_SLOT.sunX] = sx;
  slot0[VOX_SLOT.sunY] = sy;
  slot0[VOX_SLOT.sunZ] = sz;
  slot0[VOX_SLOT.sunPow] = sunPow;
  slot0[VOX_SLOT.torch] = torch;
  slot0[VOX_SLOT.palette] = paletteId(o.palette);
  slot0[VOX_SLOT.texStyle] = texId(o.textureStyle);
  slot0[VOX_SLOT.cycle] = o.cycleSpeed;
  slot0[VOX_SLOT.audioPulse] = audio;
  slot0[VOX_SLOT.reduced] = reducedMotion ? 1 : 0;
  slot0[VOX_SLOT.villageX] = 32;
  slot0[VOX_SLOT.villageZ] = -18;
  return { slot0, slot1: packMobs(t, o, cam) };
}

/** CPU smoke: lower bound on centre-pixel luma so CI never ships a black board. */
export function voxelSmokeCenterLuma(t: number, aspect = 1.6): number {
  const { slot0 } = voxelSlots(t, aspect);
  const day = slot0[VOX_SLOT.day]!;
  const sun = slot0[VOX_SLOT.sunPow]!;
  const sky = 0.12 + sun * 0.55 + (day > 0.45 && day < 0.55 ? 0.08 : 0);
  const ground = 0.18 + sun * 0.25;
  return clamp(Math.max(sky, ground) * voxelRenderScale(), 0.08, 1);
}

export function enforceVoxelCaps(o: VoxOptions): VoxOptions {
  return {
    ...o,
    viewDist: clamp(Math.round(o.viewDist), 16, VOX_MAX_VIEW),
    mobs: clamp(Math.round(o.mobs), 0, VOX_MAX_MOBS),
    cameraSpeed: clamp(o.cameraSpeed, 0.2, 2.5),
  };
}
