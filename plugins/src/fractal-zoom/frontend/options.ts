/** View config → runtime options for the fractal zoom sky. */

export const FRACTAL_TYPES = [
  "mandelbulb",
  "mandelbox",
  "menger",
  "sierpinski",
  "julia4d",
  "kaleido",
  "mandel2d",
  "julia2d",
] as const;
export type FractalType = (typeof FRACTAL_TYPES)[number];

export const ZOOM_DIRECTIONS = ["in", "out", "pingpong"] as const;
export type ZoomDirection = (typeof ZOOM_DIRECTIONS)[number];

export const PALETTE_PRESETS = [
  "cosmic",
  "ember",
  "ice",
  "acid",
  "mono",
  "sunset",
  "deep",
  "neon",
] as const;
export type PalettePreset = (typeof PALETTE_PRESETS)[number];

export interface FractalPreset {
  id: string;
  label: string;
  type: FractalType;
  power?: number;
  scale?: number;
  fold?: number;
  palette: PalettePreset;
  zoomSpeed: number;
  glow: number;
  fog: number;
  morph: boolean;
}

export const FRACTAL_PRESETS: FractalPreset[] = [
  { id: "bulb-classic", label: "Mandelbulb dive", type: "mandelbulb", power: 8, palette: "cosmic", zoomSpeed: 0.55, glow: 0.35, fog: 0.2, morph: true },
  { id: "box-abyss", label: "Mandelbox abyss", type: "mandelbox", scale: 2.1, fold: 0.55, palette: "ember", zoomSpeed: 0.45, glow: 0.4, fog: 0.35, morph: false },
  { id: "menger-tunnel", label: "Menger tunnel", type: "menger", palette: "ice", zoomSpeed: 0.5, glow: 0.25, fog: 0.15, morph: false },
  { id: "sierpinski-crystal", label: "Sierpinski crystal", type: "sierpinski", palette: "acid", zoomSpeed: 0.42, glow: 0.5, fog: 0.1, morph: true },
  { id: "julia-quaternion", label: "Quaternion Julia", type: "julia4d", palette: "sunset", zoomSpeed: 0.48, glow: 0.45, fog: 0.25, morph: true },
  { id: "kaleido-ifs", label: "Kaleidoscopic IFS", type: "kaleido", palette: "neon", zoomSpeed: 0.4, glow: 0.55, fog: 0.2, morph: true },
  { id: "mandel-deep", label: "Mandelbrot deep zoom", type: "mandel2d", palette: "deep", zoomSpeed: 0.6, glow: 0.3, fog: 0.05, morph: false },
  { id: "julia-deep", label: "Julia deep zoom", type: "julia2d", palette: "cosmic", zoomSpeed: 0.58, glow: 0.35, fog: 0.08, morph: true },
];

function num(o: Record<string, string | undefined>, key: string, def: number, min: number, max: number): number {
  const raw = o[key];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function bool(o: Record<string, string | undefined>, key: string, def: boolean): boolean {
  const raw = o[key];
  if (raw === undefined || raw === "") return def;
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

function pick<T extends string>(o: Record<string, string | undefined>, key: string, allowed: readonly T[], def: T): T {
  const raw = o[key];
  if (!raw) return def;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

export interface FractalOptions {
  type: FractalType;
  preset: string;
  zoomSpeed: number;
  zoomDir: ZoomDirection;
  autoPilot: boolean;
  paused: boolean;
  resetCam: boolean;
  manualOrbit: boolean;
  maxIter: number;
  maxSteps: number;
  detail: number;
  ao: number;
  shadow: number;
  glow: number;
  fog: number;
  dof: boolean;
  renderScale: number;
  palette: PalettePreset;
  paletteCycle: number;
  orbitTrap: boolean;
  hueShift: number;
  saturation: number;
  bg: [number, number, number];
  rollSpeed: number;
  rotateSpeed: number;
  morph: boolean;
  morphAmount: number;
  audioReactive: boolean;
  power: number;
  scale: number;
  fold: number;
  juliaCr: number;
  juliaCi: number;
  quatC2: number;
  quatC3: number;
  kaleidoSym: number;
  mandelCx: number;
  mandelCy: number;
  reducedMotion: boolean;
}

export const FRACTAL_DEFAULTS: FractalOptions = {
  type: "mandelbulb",
  preset: "bulb-classic",
  zoomSpeed: 0.35,
  zoomDir: "in",
  autoPilot: true,
  paused: false,
  resetCam: false,
  manualOrbit: false,
  maxIter: 72,
  maxSteps: 96,
  detail: 0.0012,
  ao: 0.55,
  shadow: 0.35,
  glow: 0.35,
  fog: 0.22,
  dof: false,
  renderScale: 1,
  palette: "cosmic",
  paletteCycle: 0.25,
  orbitTrap: true,
  hueShift: 0,
  saturation: 1,
  bg: [0.02, 0.04, 0.09],
  rollSpeed: 0.15,
  rotateSpeed: 0.22,
  morph: true,
  morphAmount: 0.35,
  audioReactive: true,
  power: 8,
  scale: 2.1,
  fold: 0.55,
  juliaCr: -0.745,
  juliaCi: 0.186,
  quatC2: 0.12,
  quatC3: 0.08,
  kaleidoSym: 6,
  mandelCx: -0.743643887,
  mandelCy: 0.131825904,
  reducedMotion: false,
};

function applyPresetRow(base: FractalOptions, row: FractalPreset): FractalOptions {
  return {
    ...base,
    type: row.type,
    preset: row.id,
    palette: row.palette,
    zoomSpeed: row.zoomSpeed,
    glow: row.glow,
    fog: row.fog,
    morph: row.morph,
    power: row.power ?? base.power,
    scale: row.scale ?? base.scale,
    fold: row.fold ?? base.fold,
  };
}

export function randomiseFractalOptions(seed = Math.random()): FractalOptions {
  const pickType = FRACTAL_TYPES[Math.floor(seed * 9973) % FRACTAL_TYPES.length]!;
  const pickPal = PALETTE_PRESETS[Math.floor(seed * 7919) % PALETTE_PRESETS.length]!;
  const r = (a: number, b: number) => a + (b - a) * (seed * 1.6180339887 % 1);
  return {
    ...FRACTAL_DEFAULTS,
    preset: "custom",
    type: pickType,
    palette: pickPal,
    zoomSpeed: r(0.25, 0.75),
    power: r(6, 12),
    scale: r(1.8, 2.6),
    fold: r(0.35, 0.75),
    glow: r(0.15, 0.65),
    fog: r(0.05, 0.45),
    hueShift: r(-0.35, 0.35),
    orbitTrap: seed > 0.35,
    morph: seed > 0.4,
    juliaCr: r(-1.2, 0.4),
    juliaCi: r(-0.5, 0.5),
    kaleidoSym: 3 + Math.floor(r(0, 5)),
  };
}

export function parseFractalOptions(
  o: Record<string, string | undefined> = {},
  env?: { reducedMotion?: boolean },
): FractalOptions {
  const reduced = env?.reducedMotion
    ?? (typeof globalThis !== "undefined"
      && typeof (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia === "function"
      && (globalThis as { matchMedia: (q: string) => { matches: boolean } }).matchMedia("(prefers-reduced-motion: reduce)").matches);

  let base: FractalOptions = {
    ...FRACTAL_DEFAULTS,
    reducedMotion: reduced,
    type: pick(o, "fractalType", FRACTAL_TYPES, FRACTAL_DEFAULTS.type),
    preset: o.preset ?? FRACTAL_DEFAULTS.preset,
    zoomSpeed: num(o, "zoomSpeed", reduced ? 0.08 : FRACTAL_DEFAULTS.zoomSpeed, 0, 2),
    zoomDir: pick(o, "zoomDir", ZOOM_DIRECTIONS, reduced ? "in" : FRACTAL_DEFAULTS.zoomDir),
    autoPilot: bool(o, "autoPilot", !reduced),
    paused: bool(o, "paused", reduced),
    resetCam: bool(o, "resetCam", false),
    manualOrbit: bool(o, "manualOrbit", false),
    maxIter: num(o, "maxIter", 72, 16, 160),
    maxSteps: num(o, "maxSteps", 96, 32, 192),
    detail: num(o, "detail", 0.0012, 0.0003, 0.01),
    ao: num(o, "ao", 0.55, 0, 1),
    shadow: num(o, "shadow", 0.35, 0, 1),
    glow: num(o, "glow", 0.35, 0, 1),
    fog: num(o, "fog", 0.22, 0, 1),
    dof: bool(o, "dof", false),
    renderScale: num(o, "renderScale", reduced ? 0.5 : 1, 0.25, 1),
    palette: pick(o, "palette", PALETTE_PRESETS, FRACTAL_DEFAULTS.palette),
    paletteCycle: num(o, "paletteCycle", 0.25, 0, 2),
    orbitTrap: bool(o, "orbitTrap", true),
    hueShift: num(o, "hueShift", 0, -1, 1),
    saturation: num(o, "saturation", 1, 0, 2),
    bg: [
      num(o, "bgR", FRACTAL_DEFAULTS.bg[0], 0, 1),
      num(o, "bgG", FRACTAL_DEFAULTS.bg[1], 0, 1),
      num(o, "bgB", FRACTAL_DEFAULTS.bg[2], 0, 1),
    ],
    rollSpeed: num(o, "rollSpeed", reduced ? 0 : 0.15, 0, 1),
    rotateSpeed: num(o, "rotateSpeed", reduced ? 0 : 0.22, 0, 1),
    morph: bool(o, "morph", true),
    morphAmount: num(o, "morphAmount", 0.35, 0, 1),
    audioReactive: bool(o, "audioReactive", true),
    power: num(o, "power", 8, 2, 16),
    scale: num(o, "scale", 2.1, 1.2, 3.5),
    fold: num(o, "fold", 0.55, 0.1, 1.2),
    juliaCr: num(o, "juliaCr", -0.745, -1.5, 1.5),
    juliaCi: num(o, "juliaCi", 0.186, -1.5, 1.5),
    quatC2: num(o, "quatC2", 0.12, -1, 1),
    quatC3: num(o, "quatC3", 0.08, -1, 1),
    kaleidoSym: num(o, "kaleidoSym", 6, 3, 12),
    mandelCx: num(o, "mandelCx", -0.743643887, -2, 1),
    mandelCy: num(o, "mandelCy", 0.131825904, -1.5, 1.5),
  };

  const presetId = o.preset ?? base.preset;
  if (presetId === "random") {
    base = randomiseFractalOptions(Number(o.randomSeed ?? Date.now() % 10000) / 10000);
  } else if (presetId !== "custom") {
    const row = FRACTAL_PRESETS.find((p) => p.id === presetId);
    if (row) base = applyPresetRow(base, row);
  }

  if (o.randomise === "roll") {
    base = { ...randomiseFractalOptions(Math.random()), preset: "custom" };
  }

  return base;
}

export function fractalTypeIndex(t: FractalType): number {
  return FRACTAL_TYPES.indexOf(t);
}

export function paletteIndex(p: PalettePreset): number {
  return PALETTE_PRESETS.indexOf(p);
}
