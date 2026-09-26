/** View options — every knob comes from visualisation.yml config via config.read. */

import { marbleWorkBudget, type MarbleWorkBudget } from "./work-budget";

export function marblePackWorkBudget(): MarbleWorkBudget {
  return marbleWorkBudget();
}

export const MARBLE_DATA_MAPPING = [
  { field: "packets[].proto", effect: "marble hue (protocol hash)", default: "tcp", clamp: "hash01" },
  { field: "packets[].size", effect: "marble radius", default: 128, clamp: "6..48" },
  { field: "packets[].field", effect: "marble radius when sizeField=field", default: 0.5, clamp: "0..1" },
  { field: "sys.failed", effect: "reject tray when above failThreshold", default: 0, clamp: "0..1" },
] as const;

export type MarblePreset = "workshop" | "glass-tower" | "chaos-funnel" | "calm-spiral";
export type MaterialTheme = "walnut" | "oak" | "brass-glass" | "bamboo";
export type CameraMode = "follow" | "wide" | "orbit";
export type SizeField = "bytes" | "field";
export type DestField = "hash" | "proto";

export interface MarbleOptions {
  preset: MarblePreset;
  seed: number;
  complexity: number;
  maxMarbles: number;
  materialTheme: MaterialTheme;
  cameraMode: CameraMode;
  jarCount: number;
  sizeField: SizeField;
  destField: DestField;
  failThreshold: number;
  reducedMotion: "auto" | "on" | "off";
}

export const MARBLE_DEFAULTS: MarbleOptions = {
  preset: "workshop",
  seed: 4242,
  complexity: 3,
  maxMarbles: 32,
  materialTheme: "walnut",
  cameraMode: "follow",
  jarCount: 6,
  sizeField: "bytes",
  destField: "proto",
  failThreshold: 0.55,
  reducedMotion: "auto",
};

const PRESET_PATCH: Record<MarblePreset, Partial<MarbleOptions>> = {
  workshop: { seed: 4242, complexity: 3, materialTheme: "walnut", cameraMode: "follow" },
  "glass-tower": { seed: 8801, complexity: 4, materialTheme: "brass-glass", cameraMode: "orbit" },
  "chaos-funnel": { seed: 1337, complexity: 5, materialTheme: "oak", cameraMode: "follow" },
  "calm-spiral": { seed: 9001, complexity: 2, materialTheme: "bamboo", cameraMode: "wide" },
};

function num(raw: string | undefined, def: number, lo: number, hi: number): number {
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

function sel<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return def;
}

export function parseMarbleOptions(raw: Record<string, string | undefined> = {}): MarbleOptions {
  const preset = sel(raw.preset, ["workshop", "glass-tower", "chaos-funnel", "calm-spiral"] as const, MARBLE_DEFAULTS.preset);
  const patch = PRESET_PATCH[preset];
  const budget = marbleWorkBudget();
  const base: MarbleOptions = {
    preset,
    seed: num(raw.seed, patch.seed ?? MARBLE_DEFAULTS.seed, 1, 999_999),
    complexity: Math.round(num(raw.complexity, patch.complexity ?? MARBLE_DEFAULTS.complexity, 1, 5)),
    maxMarbles: Math.round(num(raw.maxMarbles, MARBLE_DEFAULTS.maxMarbles, 8, budget.maxInstances)),
    materialTheme: sel(raw.materialTheme, ["walnut", "oak", "brass-glass", "bamboo"] as const, patch.materialTheme ?? MARBLE_DEFAULTS.materialTheme),
    cameraMode: sel(raw.cameraMode, ["follow", "wide", "orbit"] as const, patch.cameraMode ?? MARBLE_DEFAULTS.cameraMode),
    jarCount: Math.round(num(raw.jarCount, MARBLE_DEFAULTS.jarCount, 3, 8)),
    sizeField: sel(raw.sizeField, ["bytes", "field"] as const, MARBLE_DEFAULTS.sizeField),
    destField: sel(raw.destField, ["hash", "proto"] as const, MARBLE_DEFAULTS.destField),
    failThreshold: num(raw.failThreshold, MARBLE_DEFAULTS.failThreshold, 0.2, 0.95),
    reducedMotion: sel(raw.reducedMotion, ["auto", "on", "off"] as const, MARBLE_DEFAULTS.reducedMotion),
  };
  return base;
}

/** Zoto Fail — failures first, always visible on the reject tray. */
export const ZOTO_FAIL_RGB: [number, number, number] = [0.937, 0.325, 0.314];

export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
