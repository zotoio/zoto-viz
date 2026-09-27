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
  { id: "bulb-classic", label: "Classic Dive", type: "mandelbulb", power: 8, palette: "cosmic", zoomSpeed: 0.55, glow: 0.35, fog: 0.2, morph: true },
  { id: "box-abyss", label: "Deep Cathedral", type: "mandelbox", scale: 2.1, fold: 0.55, palette: "ember", zoomSpeed: 0.45, glow: 0.4, fog: 0.35, morph: false },
  { id: "menger-tunnel", label: "Menger Tunnel", type: "menger", palette: "ice", zoomSpeed: 0.5, glow: 0.25, fog: 0.15, morph: false },
  { id: "sierpinski-crystal", label: "Crystal Spire", type: "sierpinski", palette: "acid", zoomSpeed: 0.42, glow: 0.5, fog: 0.1, morph: true },
  { id: "julia-quaternion", label: "Quaternion Bloom", type: "julia4d", palette: "sunset", zoomSpeed: 0.48, glow: 0.45, fog: 0.25, morph: true },
  { id: "kaleido-ifs", label: "Kaleidoscope", type: "kaleido", palette: "neon", zoomSpeed: 0.4, glow: 0.55, fog: 0.2, morph: true },
  { id: "mandel-deep", label: "Seahorse Valley", type: "mandel2d", palette: "deep", zoomSpeed: 0.6, glow: 0.3, fog: 0.05, morph: false },
  { id: "julia-deep", label: "Julia Spiral", type: "julia2d", palette: "cosmic", zoomSpeed: 0.58, glow: 0.35, fog: 0.08, morph: true },
];

/** Host sliders clamp; pack only coerces types. */
function num(o: Record<string, string | undefined>, key: string, def: number): number {
  const raw = o[key];
  if (raw === undefined || raw === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
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
  type: "mandel2d",
  preset: "mandel-deep",
  zoomSpeed: 0.55,
  zoomDir: "in",
  autoPilot: true,
  paused: false,
  resetCam: false,
  manualOrbit: false,
  maxIter: 32,
  maxSteps: 32,
  detail: 0.0012,
  ao: 0.55,
  shadow: 0.35,
  glow: 0.35,
  fog: 0.22,
  dof: false,
  renderScale: 1,
  palette: "deep",
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

export function applyPresetRow(base: FractalOptions, row: FractalPreset): FractalOptions {
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

  const presetId = o.preset ?? FRACTAL_DEFAULTS.preset;
  let base: FractalOptions = { ...FRACTAL_DEFAULTS, reducedMotion: reduced, preset: presetId };
  if (presetId !== "custom") {
    const row = FRACTAL_PRESETS.find((p) => p.id === presetId);
    if (row) base = applyPresetRow(base, row);
  }

  const p = base;
  base = {
    ...p,
    type: pick(o, "fractalType", FRACTAL_TYPES, p.type),
    preset: o.preset ?? p.preset,
    zoomSpeed: num(o, "zoomSpeed", reduced ? Math.min(0.08, p.zoomSpeed) : p.zoomSpeed),
    zoomDir: pick(o, "zoomDir", ZOOM_DIRECTIONS, reduced ? "in" : p.zoomDir),
    autoPilot: bool(o, "autoPilot", reduced ? false : p.autoPilot),
    paused: bool(o, "paused", reduced ? true : p.paused),
    resetCam: bool(o, "resetCam", false),
    manualOrbit: false,
    maxIter: num(o, "maxIter", p.maxIter),
    maxSteps: num(o, "maxSteps", p.maxSteps),
    detail: num(o, "detail", p.detail),
    ao: num(o, "ao", p.ao),
    shadow: num(o, "shadow", p.shadow),
    glow: num(o, "glow", p.glow),
    fog: num(o, "fog", p.fog),
    dof: bool(o, "dof", p.dof),
    renderScale: 1,
    palette: pick(o, "palette", PALETTE_PRESETS, p.palette),
    paletteCycle: num(o, "paletteCycle", p.paletteCycle),
    orbitTrap: bool(o, "orbitTrap", p.orbitTrap),
    hueShift: num(o, "hueShift", p.hueShift),
    saturation: num(o, "saturation", p.saturation),
    bg: [
      num(o, "bgR", p.bg[0]),
      num(o, "bgG", p.bg[1]),
      num(o, "bgB", p.bg[2]),
    ],
    rollSpeed: num(o, "rollSpeed", reduced ? 0 : p.rollSpeed),
    rotateSpeed: num(o, "rotateSpeed", reduced ? 0 : p.rotateSpeed),
    morph: bool(o, "morph", p.morph),
    morphAmount: num(o, "morphAmount", p.morphAmount),
    audioReactive: bool(o, "audioReactive", p.audioReactive),
    power: num(o, "power", p.power),
    scale: num(o, "scale", p.scale),
    fold: num(o, "fold", p.fold),
    juliaCr: num(o, "juliaCr", p.juliaCr),
    juliaCi: num(o, "juliaCi", p.juliaCi),
    quatC2: num(o, "quatC2", p.quatC2),
    quatC3: num(o, "quatC3", p.quatC3),
    kaleidoSym: num(o, "kaleidoSym", p.kaleidoSym),
    mandelCx: num(o, "mandelCx", p.mandelCx),
    mandelCy: num(o, "mandelCy", p.mandelCy),
  };

  return base;
}

export function fractalTypeIndex(t: FractalType): number {
  return FRACTAL_TYPES.indexOf(t);
}

export function paletteIndex(p: PalettePreset): number {
  return PALETTE_PRESETS.indexOf(p);
}
