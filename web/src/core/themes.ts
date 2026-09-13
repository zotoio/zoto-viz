import { ROLE_COLOR, type Role } from "./types";

/**
 * Colour themes. A theme covers the whole surface: the chrome (header, panel, legend, labels via CSS
 * variables), the 3D scene (background, fog, floor grid, rim light, default edge and particle colours,
 * blending) and the role palette that modes and legends read from ROLE_COLOR.
 */

export interface ThemeUI {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  /** stronger separator / hover border */
  lineStrong: string;
  /** translucent surface for panel and menus */
  panel: string;
  /** control background and its hover state */
  chip: string;
  chipHover: string;
  /** primary highlight: focus rings, active switches, selected option */
  accent: string;
  /** attention colour: redact switch, mode labels in the scene */
  warn: string;
  link: string;
  /** text-shadow behind scene labels so they stay legible over edges */
  labelShadow: string;
  /** background of overlay tags in the scene */
  overlay: string;
}

export interface ThemeScene {
  clear: number;
  fog: number;
  gridMajor: number;
  gridMinor: number;
  rim: number;
  /** default edge colours in topology-style modes */
  lanEdge: number;
  wanEdge: number;
  tether: number;
  /** default particle colours (lightened edge colours) */
  lanParticle: number;
  wanParticle: number;
  /** colour particles are pulled toward when a mode colours the edge */
  particleTint: number;
  /** additive blending fades dim edges into a dark background; light themes need normal blending */
  additive: boolean;
}

export interface Theme {
  id: string;
  label: string;
  hint: string;
  dark: boolean;
  ui: ThemeUI;
  scene: ThemeScene;
  roles: Record<Role, number>;
}

export const toCssHex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const hex = toCssHex;
const rgb = (h: string) => `${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}`;

/** Fill in the derived parts of a theme from a compact spec. */
function make(spec: {
  id: string; label: string; hint: string; dark?: boolean;
  bg: string; fg: string; muted: string; line: string; accent: string; warn: string; link?: string;
  roles: Record<Role, number>;
  scene: Partial<ThemeScene> & { lanEdge: number; wanEdge: number };
}): Theme {
  const dark = spec.dark ?? true;
  const bgNum = parseInt(spec.bg.slice(1), 16);
  const chipA = dark ? 0.06 : 0.6;
  return {
    id: spec.id, label: spec.label, hint: spec.hint, dark,
    ui: {
      bg: spec.bg, fg: spec.fg, muted: spec.muted, line: spec.line,
      lineStrong: dark ? `color-mix(in srgb, ${spec.line} 60%, ${spec.fg})` : `color-mix(in srgb, ${spec.line} 70%, ${spec.fg})`,
      panel: dark ? `rgba(${rgb(spec.bg)}, 0.92)` : `rgba(255, 255, 255, 0.92)`,
      chip: `rgba(255, 255, 255, ${chipA})`,
      chipHover: dark ? `rgba(255, 255, 255, ${chipA * 2})` : `rgba(255, 255, 255, 0.95)`,
      accent: spec.accent, warn: spec.warn, link: spec.link ?? spec.accent,
      labelShadow: dark ? "0 0 2px #000" : `0 0 2px ${spec.bg}, 0 1px 0 ${spec.bg}`,
      overlay: dark ? `rgba(${rgb(spec.bg)}, 0.7)` : `rgba(255, 255, 255, 0.8)`,
    },
    scene: {
      clear: bgNum, fog: bgNum,
      gridMajor: spec.scene.gridMajor ?? mix(spec.scene.lanEdge, bgNum, dark ? 0.32 : 0.38),
      gridMinor: spec.scene.gridMinor ?? mix(spec.scene.lanEdge, bgNum, dark ? 0.62 : 0.58),
      rim: spec.scene.rim ?? spec.scene.lanEdge,
      lanEdge: spec.scene.lanEdge, wanEdge: spec.scene.wanEdge,
      tether: spec.scene.tether ?? mix(bgNum, 0xffffff, dark ? 0.22 : -0.3),
      lanParticle: spec.scene.lanParticle ?? mix(spec.scene.lanEdge, dark ? 0xffffff : 0x000000, 0.4),
      wanParticle: spec.scene.wanParticle ?? mix(spec.scene.wanEdge, dark ? 0xffffff : 0x000000, 0.4),
      particleTint: spec.scene.particleTint ?? (dark ? 0xffffff : 0x101318),
      additive: spec.scene.additive ?? dark,
    },
    roles: spec.roles,
  };
}

/** Mix `hex` toward black (dark themes) or white (light) by `1 - opacity`. 1 = original, 0 = pole. */
export function fadeTowardPole(hex: number, opacity: number, dark: boolean): number {
  const t = 1 - Math.min(1, Math.max(0, opacity));
  return t <= 0 ? hex : mix(hex, dark ? 0x000000 : 0xffffff, t);
}

/** Linear mix of two packed RGB colours; negative t darkens toward black instead of mixing toward b. */
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255, y = t < 0 ? 0 : (b >> s) & 255, k = Math.abs(t);
    return Math.round(x + (y - x) * k) & 255;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** WCAG 2 relative luminance of a packed sRGB colour (0–1). */
export function relativeLuminance(hex: number): number {
  const ch = (s: number) => {
    const v = ((hex >> s) & 255) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
}

/** WCAG contrast ratio of two packed sRGB colours (≥ 1). */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Grey whose luminance is `lum`, for contrast checks against a sky-adjusted scene. */
export function grayHex(lum: number): number {
  const y = Math.min(1, Math.max(0, lum));
  // invert the sRGB transfer so the grey's WCAG luminance matches `lum`
  const v = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  const n = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return (n << 16) | (n << 8) | n;
}

/**
 * Approximate what the eye sees behind labels: the clear colour mixed with the sky.
 * Fractal / live can blow out; space and matrix stay dark. `bright` is the sky slider (0–2).
 */
export function effectiveSceneLuminance(
  fillHex: number,
  sky: { kind?: string; opacity?: number; bright?: number } = {},
): number {
  const fill = relativeLuminance(fillHex);
  const kind = sky.kind ?? "none";
  const op = Math.min(1, Math.max(0, sky.opacity ?? 1));
  const bright = Math.min(2, Math.max(0, sky.bright ?? 1));
  if (kind === "none" || op <= 0) return fill;
  let skyLum = fill;
  if (kind === "space") skyLum = 0.12 + fill * 0.2;
  else if (kind === "fractal") skyLum = 0.38 + fill * 0.35;
  else if (kind === "matrix") skyLum = 0.06 + fill * 0.08;
  else if (kind === "live") skyLum = 0.5;
  else return fill;
  return fill * (1 - op) + Math.min(1, skyLum * bright) * op;
}

const INK_DARK = 0x111318;
const INK_LIGHT = 0xf4f6fb;
const MUTED_ON_LIGHT = "#3d4654";
const MUTED_ON_DARK = "#c9cfdb";
const SHADOW_FOR_DARK_TEXT = "0 0 2px #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff";
const SHADOW_FOR_LIGHT_TEXT = "0 0 2px #000, 0 1px 0 #000, 0 -1px 0 #000, 1px 0 0 #000, -1px 0 0 #000";

export interface SceneInk {
  fg: string;
  muted: string;
  shadow: string;
  fgHex: number;
  darkText: boolean;
}

/**
 * Black or white scene ink, whichever contrasts more with `bgHex`.
 * `hold` is the last choice; switching needs the other ink to win by 15% so a pulsing sky does not flicker.
 */
export function sceneInk(bgHex: number, hold?: boolean): SceneInk {
  const darkC = contrastRatio(INK_DARK, bgHex);
  const lightC = contrastRatio(INK_LIGHT, bgHex);
  let darkText = darkC >= lightC;
  if (hold !== undefined) {
    const cur = hold ? darkC : lightC;
    const other = hold ? lightC : darkC;
    darkText = other > cur * 1.15 ? !hold : hold;
  }
  return darkText
    ? { fg: "#111318", muted: MUTED_ON_LIGHT, shadow: SHADOW_FOR_DARK_TEXT, fgHex: INK_DARK, darkText: true }
    : { fg: "#f4f6fb", muted: MUTED_ON_DARK, shadow: SHADOW_FOR_LIGHT_TEXT, fgHex: INK_LIGHT, darkText: false };
}

function inkVars(t: Theme): Record<string, string> {
  const ink = sceneInk(parseInt(t.ui.bg.slice(1), 16));
  return { "--label-fg": ink.fg, "--label-muted": ink.muted, "--label-shadow": ink.shadow };
}

export const THEMES: Theme[] = [
  make({
    id: "midnight", label: "Midnight", hint: "default, blue on near-black",
    bg: "#0b0e14", fg: "#e6e8ee", muted: "#8a93a6", line: "#232a3a", accent: "#5aa9ff", warn: "#ffd54f", link: "#90caf9",
    roles: { self: 0x42a5f5, gateway: 0xff7043, lan: 0x66bb6a, local: 0x26c6da, internet: 0xab47bc, multicast: 0x9e9e9e },
    scene: { lanEdge: 0x5aa9ff, wanEdge: 0xc97bff, rim: 0x4477ff, tether: 0x3a4256, lanParticle: 0x9fd0ff, wanParticle: 0xe6b3ff },
  }),
  make({
    id: "ocean", label: "Ocean", hint: "deep teal and cyan",
    bg: "#071a2b", fg: "#dcecf7", muted: "#7fa0b8", line: "#12314a", accent: "#4cc9f0", warn: "#ffd166", link: "#8fdcff",
    roles: { self: 0x4cc9f0, gateway: 0xf4a261, lan: 0x80ed99, local: 0x48cae4, internet: 0xc77dff, multicast: 0x5c7c96 },
    scene: { lanEdge: 0x4cc9f0, wanEdge: 0xc77dff, rim: 0x2a9d8f },
  }),
  make({
    id: "nord", label: "Nord", hint: "arctic, bluish greys",
    bg: "#2e3440", fg: "#eceff4", muted: "#9aa5b8", line: "#3b4252", accent: "#88c0d0", warn: "#ebcb8b", link: "#81a1c1",
    roles: { self: 0x88c0d0, gateway: 0xd08770, lan: 0xa3be8c, local: 0x8fbcbb, internet: 0xb48ead, multicast: 0x7b88a1 },
    scene: { lanEdge: 0x81a1c1, wanEdge: 0xb48ead, rim: 0x5e81ac },
  }),
  make({
    id: "dracula", label: "Dracula", hint: "purple, pink and green",
    bg: "#282a36", fg: "#f8f8f2", muted: "#8b8fa8", line: "#44475a", accent: "#bd93f9", warn: "#f1fa8c", link: "#8be9fd",
    roles: { self: 0x8be9fd, gateway: 0xffb86c, lan: 0x50fa7b, local: 0xbd93f9, internet: 0xff79c6, multicast: 0x6272a4 },
    scene: { lanEdge: 0x8be9fd, wanEdge: 0xff79c6, rim: 0xbd93f9 },
  }),
  make({
    id: "solarized", label: "Solarized", hint: "dark, warm base tones",
    bg: "#002b36", fg: "#eee8d5", muted: "#839496", line: "#073642", accent: "#268bd2", warn: "#b58900", link: "#2aa198",
    roles: { self: 0x268bd2, gateway: 0xcb4b16, lan: 0x859900, local: 0x2aa198, internet: 0x6c71c4, multicast: 0x586e75 },
    scene: { lanEdge: 0x268bd2, wanEdge: 0xd33682, rim: 0x2aa198 },
  }),
  make({
    id: "gruvbox", label: "Gruvbox", hint: "retro, earthy",
    bg: "#282828", fg: "#ebdbb2", muted: "#a89984", line: "#3c3836", accent: "#83a598", warn: "#fabd2f", link: "#8ec07c",
    roles: { self: 0x83a598, gateway: 0xfe8019, lan: 0xb8bb26, local: 0x8ec07c, internet: 0xd3869b, multicast: 0x928374 },
    scene: { lanEdge: 0x83a598, wanEdge: 0xd3869b, rim: 0xd65d0e },
  }),
  make({
    id: "ember", label: "Ember", hint: "warm amber on charcoal",
    bg: "#1a1412", fg: "#f3e9dc", muted: "#a08c7d", line: "#33281f", accent: "#ffb347", warn: "#ffe08a", link: "#ffc67a",
    roles: { self: 0xffb347, gateway: 0xff5e3a, lan: 0xc7d36f, local: 0xf7c59f, internet: 0xc084fc, multicast: 0x7a6a5f },
    scene: { lanEdge: 0xffa06b, wanEdge: 0xe06c9f, rim: 0xff5e3a },
  }),
  make({
    id: "neon", label: "Neon", hint: "saturated cyberpunk",
    bg: "#050510", fg: "#e8f6ff", muted: "#7f8fb0", line: "#1c2140", accent: "#00e5ff", warn: "#ffe600", link: "#5df2ff",
    roles: { self: 0x00e5ff, gateway: 0xff9100, lan: 0x39ff14, local: 0x18ffff, internet: 0xff2bd6, multicast: 0x5c6bc0 },
    scene: { lanEdge: 0x00e5ff, wanEdge: 0xff2bd6, rim: 0xff2bd6 },
  }),
  make({
    id: "tactical", label: "Tactical", hint: "phosphor green on olive-black",
    bg: "#0b100c", fg: "#d7e6c9", muted: "#7d9173", line: "#243328", accent: "#8cff5a", warn: "#ffbf3c", link: "#b6f08a",
    roles: { self: 0x8cff5a, gateway: 0xffbf3c, lan: 0x6dbf4c, local: 0xc6d94e, internet: 0x4aa3a0, multicast: 0x5c6b56 },
    scene: { lanEdge: 0x8cff5a, wanEdge: 0xffbf3c, rim: 0x3d6b32, tether: 0x2a382c, lanParticle: 0xc8ff9a, wanParticle: 0xffd27a },
  }),
  make({
    id: "paper", label: "Paper", hint: "light, for bright rooms",
    dark: false,
    bg: "#f5f4ef", fg: "#1f2430", muted: "#6b7280", line: "#d9d6cc", accent: "#1e6fd9", warn: "#b45309", link: "#1e6fd9",
    roles: { self: 0x1e6fd9, gateway: 0xd9480f, lan: 0x2f9e44, local: 0x0c8599, internet: 0x7048e8, multicast: 0x868e96 },
    scene: { lanEdge: 0x1565c0, wanEdge: 0x5e35b1, rim: 0x1e6fd9 },
  }),
];

export const DEFAULT_THEME = THEMES[0];

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** Small gradient for the theme picker: background, accent and the LAN role colour. */
export function themeSwatch(t: Theme): string {
  return `linear-gradient(135deg, ${t.ui.bg} 0 45%, ${t.ui.accent} 45% 72%, ${hex(t.roles.lan)} 72%)`;
}

/**
 * Next unused palette for a mosaic tile. `prefer` wins when it is not already taken.
 * Wraps if every shipped theme is already in use.
 */
export function takeTheme(used: Set<string>, prefer?: string | null): Theme {
  if (prefer) {
    const t = themeById(prefer);
    if (!used.has(t.id)) {
      used.add(t.id);
      return t;
    }
  }
  for (const t of THEMES) {
    if (!used.has(t.id)) {
      used.add(t.id);
      return t;
    }
  }
  const t = THEMES[used.size % THEMES.length]!;
  used.add(`${t.id}#${used.size}`);
  return t;
}

/** Scope chrome variables to one mosaic pane so its caption and labels follow that pane's palette. */
export function applyPaneChrome(el: HTMLElement, t: Theme): void {
  const s = el.style;
  const u = t.ui;
  const vars: Record<string, string> = {
    "--bg": u.bg, "--bg-rgb": rgb(u.bg), "--fg": u.fg, "--muted": u.muted, "--line": u.line, "--line-strong": u.lineStrong,
    "--panel": u.panel, "--accent": u.accent, "--accent-rgb": rgb(u.accent),
    "--warn": u.warn, "--link": u.link, "--overlay": u.overlay,
    "--scene-bg": u.bg, ...inkVars(t),
  };
  for (const [k, v] of Object.entries(vars)) s.setProperty(k, v);
  el.dataset.theme = t.id;
}

/** Push the chrome part of a theme into CSS variables and the role palette into ROLE_COLOR. */
export function applyThemeChrome(t: Theme): void {
  const s = document.documentElement.style;
  const u = t.ui;
  const vars: Record<string, string> = {
    "--bg": u.bg, "--bg-rgb": rgb(u.bg), "--fg": u.fg, "--muted": u.muted, "--line": u.line, "--line-strong": u.lineStrong,
    "--panel": u.panel, "--chip": u.chip, "--chip-hover": u.chipHover, "--accent": u.accent, "--accent-rgb": rgb(u.accent),
    "--warn": u.warn, "--link": u.link, "--overlay": u.overlay,
    "--shadow": t.dark ? "rgba(0, 0, 0, 0.45)" : "rgba(30, 40, 60, 0.18)",
    ...inkVars(t),
  };
  for (const [k, v] of Object.entries(vars)) s.setProperty(k, v);
  s.setProperty("color-scheme", t.dark ? "dark" : "light");
  document.documentElement.dataset.theme = t.id;
  Object.assign(ROLE_COLOR, t.roles);
}

/**
 * Retint a theme so its chromatic colours (accent, edges, roles) take the hue of `sample`
 * (packed RGB from the webcam). Greys, the background, body text and warn stay put so Midnight
 * stays dark and alerts stay yellow. Lightness of each colour is kept.
 */
export function alignThemeToColor(base: Theme, sample: number): Theme {
  const from = rgbToHsl(parseInt(base.ui.accent.slice(1), 16));
  const to = rgbToHsl(sample);
  if (to.s < 0.08) return base;
  const d = to.h - from.h;
  const num = (n: number) => shiftHex(n, d, to.s);
  const str = (s: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    return toCssHex(num(parseInt(s.slice(1), 16)));
  };
  const roles = { ...base.roles };
  for (const k of Object.keys(roles) as Role[]) roles[k] = num(roles[k]!);
  const sc = base.scene;
  return {
    ...base,
    ui: { ...base.ui, accent: str(base.ui.accent), link: str(base.ui.link) },
    scene: {
      ...sc,
      rim: num(sc.rim), lanEdge: num(sc.lanEdge), wanEdge: num(sc.wanEdge),
      lanParticle: num(sc.lanParticle), wanParticle: num(sc.wanParticle),
      gridMajor: num(sc.gridMajor), gridMinor: num(sc.gridMinor),
    },
    roles,
  };
}

export function hexToHsl(n: number): Hsl { return rgbToHsl(n); }
export function hslHex(h: number, s: number, l: number): number { return hslToRgb(h, s, l); }

interface Hsl { h: number; s: number; l: number }

function rgbToHsl(n: number): Hsl {
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): number {
  h = ((h % 1) + 1) % 1;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  if (s < 1e-6) {
    const v = Math.round(l * 255);
    return (v << 16) | (v << 8) | v;
  }
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue(p, q, h) * 255);
  const b = Math.round(hue(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}

/** Rotate hue by `d` (0–1 turns). Low-chroma colours stay; saturation leans a little toward the sample. */
function shiftHex(n: number, d: number, sampleS: number): number {
  const c = rgbToHsl(n);
  if (c.s < 0.16 || c.l < 0.14 || c.l > 0.92) return n;
  return hslToRgb(c.h + d, c.s * 0.55 + sampleS * 0.45, c.l);
}
