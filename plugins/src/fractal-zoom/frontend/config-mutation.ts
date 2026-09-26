import {
  FRACTAL_PRESETS,
  FRACTAL_TYPES,
  type FractalPreset,
  randomiseFractalOptions,
} from "./options";

export const FRACTAL_CONFIG_KEYS = [
  "fractalType", "zoomSpeed", "zoomDir", "autoPilot", "paused", "resetCam",
  "maxIter", "maxSteps", "detail", "ao", "shadow", "glow", "fog", "dof",
  "palette", "paletteCycle", "orbitTrap", "hueShift", "saturation",
  "bgR", "bgG", "bgB", "rollSpeed", "rotateSpeed", "morph", "morphAmount", "audioReactive",
  "power", "scale", "fold", "juliaCr", "juliaCi", "quatC2", "quatC3", "kaleidoSym", "mandelCx", "mandelCy",
] as const;

function optToStrings(o: ReturnType<typeof randomiseFractalOptions>): Record<string, string> {
  return {
    fractalType: o.type,
    zoomSpeed: String(o.zoomSpeed),
    zoomDir: o.zoomDir,
    autoPilot: o.autoPilot ? "1" : "0",
    paused: o.paused ? "1" : "0",
    resetCam: "0",
    maxIter: String(o.maxIter),
    maxSteps: String(o.maxSteps),
    detail: String(o.detail),
    ao: String(o.ao),
    shadow: String(o.shadow),
    glow: String(o.glow),
    fog: String(o.fog),
    dof: o.dof ? "1" : "0",
    palette: o.palette,
    paletteCycle: String(o.paletteCycle),
    orbitTrap: o.orbitTrap ? "1" : "0",
    hueShift: String(o.hueShift),
    saturation: String(o.saturation),
    bgR: String(o.bg[0]),
    bgG: String(o.bg[1]),
    bgB: String(o.bg[2]),
    rollSpeed: String(o.rollSpeed),
    rotateSpeed: String(o.rotateSpeed),
    morph: o.morph ? "1" : "0",
    morphAmount: String(o.morphAmount),
    audioReactive: o.audioReactive ? "1" : "0",
    power: String(o.power),
    scale: String(o.scale),
    fold: String(o.fold),
    juliaCr: String(o.juliaCr),
    juliaCi: String(o.juliaCi),
    quatC2: String(o.quatC2),
    quatC3: String(o.quatC3),
    kaleidoSym: String(Math.round(o.kaleidoSym)),
    mandelCx: String(o.mandelCx),
    mandelCy: String(o.mandelCy),
  };
}

function presetRowToStrings(row: FractalPreset): Record<string, string> {
  const o = randomiseFractalOptions(0.5);
  o.type = row.type;
  o.preset = row.id;
  o.palette = row.palette;
  o.zoomSpeed = row.zoomSpeed;
  o.glow = row.glow;
  o.fog = row.fog;
  o.morph = row.morph;
  if (row.power !== undefined) o.power = row.power;
  if (row.scale !== undefined) o.scale = row.scale;
  if (row.fold !== undefined) o.fold = row.fold;
  return optToStrings(o);
}

export function fractalPresetConfig(presetId: string): Record<string, string> {
  const row = FRACTAL_PRESETS.find((p) => p.id === presetId);
  if (!row) return {};
  return { preset: presetId, ...presetRowToStrings(row) };
}

export function fractalRandomConfig(seed = Math.random()): Record<string, string> {
  return { preset: "custom", ...optToStrings(randomiseFractalOptions(seed)) };
}

export function fractalTypeLabel(type: string): string {
  const row = FRACTAL_TYPES.find((t) => t === type);
  if (!row) return type;
  const labels: Record<string, string> = {
    mandelbulb: "Mandelbulb",
    mandelbox: "Mandelbox",
    menger: "Menger sponge",
    sierpinski: "Sierpinski",
    julia4d: "Quaternion Julia",
    kaleido: "Kaleidoscopic IFS",
    mandel2d: "Mandelbrot 2D",
    julia2d: "Julia 2D",
  };
  return labels[row] ?? row;
}

export function fractalPresetLabel(presetId: string): string {
  return FRACTAL_PRESETS.find((p) => p.id === presetId)?.label ?? presetId;
}

export function validatePresetKeysAgainstSchema(keys: readonly string[]): string[] {
  const allowed = new Set<string>(FRACTAL_CONFIG_KEYS);
  return keys.filter((k) => !allowed.has(k));
}

/** Worst-case slider combo per type (host clamps to plugin.yml max). */
export function worstCaseFractalConfig(type: (typeof FRACTAL_TYPES)[number]): Record<string, string> {
  return {
    fractalType: type,
    preset: "custom",
    maxIter: "96",
    maxSteps: "128",
    detail: "0.0003",
    shadow: "1",
    ao: "1",
    glow: "0.65",
    fog: "0.45",
    orbitTrap: "1",
    morph: "1",
    morphAmount: "0.85",
    audioReactive: "1",
    zoomSpeed: "0.75",
    power: "12",
    scale: "2.6",
    fold: "0.75",
    kaleidoSym: "8",
  };
}
