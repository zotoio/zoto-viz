export const NIXIE_LOOK_KEYS = ["format", "seconds", "glow", "flicker"] as const;
export type NixieLookKey = (typeof NIXIE_LOOK_KEYS)[number];

export type NixieLook = {
  hour12: boolean;
  seconds: boolean;
  glow: number;
  flicker: number;
};

type LookFieldMap = Record<NixieLookKey, keyof NixieLook>;

function assertLookFieldMap(m: LookFieldMap): LookFieldMap {
  const fields = new Set(Object.values(m));
  const keys = new Set(NIXIE_LOOK_KEYS);
  if (fields.size !== NIXIE_LOOK_KEYS.length || keys.size !== fields.size) {
    throw new Error("NIXIE_LOOK_FIELD_BY_KEY must map each key to a distinct NixieLook field");
  }
  return m;
}

/** Plugin option key → parsed {@link NixieLook} field (every look field exactly once). */
export const NIXIE_LOOK_FIELD_BY_KEY = assertLookFieldMap({
  format: "hour12",
  seconds: "seconds",
  glow: "glow",
  flicker: "flicker",
} satisfies LookFieldMap);

type _AssertAllLookFieldsMapped = Exclude<keyof NixieLook, LookFieldMap[NixieLookKey]>;
type _AssertNoExtraLookFields = _AssertAllLookFieldsMapped extends never ? true : never;
const _nixieLookFieldExhaustive: _AssertNoExtraLookFields = true;

export const DEFAULT_LOOK: NixieLook = {
  hour12: false,
  seconds: true,
  glow: 1,
  flicker: 0.22,
};

export const CANVAS_DEFAULT = { w: 1280, h: 800 };

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function optPresent(cfg: Record<string, string> | null | undefined, key: NixieLookKey): boolean {
  return cfg != null && Object.prototype.hasOwnProperty.call(cfg, key);
}

export function parseNixieLook(cfg?: Record<string, string> | null, prev?: NixieLook): NixieLook {
  const format = cfg?.format;
  const seconds = cfg?.seconds;
  const glowPresent = optPresent(cfg, "glow");
  const flickerPresent = optPresent(cfg, "flicker");
  const glowRaw = cfg?.glow;
  const flickerRaw = cfg?.flicker;
  let glow = prev?.glow ?? DEFAULT_LOOK.glow;
  if (glowPresent) {
    const g = glowRaw === "" ? 0 : Number(glowRaw);
    glow = clamp(Number.isFinite(g) ? g : DEFAULT_LOOK.glow, 0.4, 1.6);
  }
  let flicker = prev?.flicker ?? DEFAULT_LOOK.flicker;
  if (flickerPresent) {
    const f = flickerRaw === "" ? 0 : Number(flickerRaw);
    flicker = clamp(Number.isFinite(f) ? f : DEFAULT_LOOK.flicker, 0, 1);
  }
  const hour12 = format === "12" ? true : format === "24" ? false : (prev?.hour12 ?? DEFAULT_LOOK.hour12);
  const sec = seconds !== undefined
    ? seconds !== "0" && seconds !== "false"
    : (prev?.seconds ?? DEFAULT_LOOK.seconds);
  return {
    hour12,
    seconds: sec,
    glow,
    flicker,
  };
}

/** Packed slot value: tube draws blank (12h leading zero suppression). */
export const NIXIE_DIGIT_BLANK = -1;

export function digitsOf(date: Date, hour12: boolean): [number, number, number, number, number, number] {
  const h24 = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  let hour = h24;
  if (hour12) {
    hour = h24 % 12;
    if (hour === 0) hour = 12;
  }
  const h10 = hour12 && hour >= 1 && hour <= 9
    ? NIXIE_DIGIT_BLANK
    : Math.floor(hour / 10);
  return [
    h10, hour % 10,
    Math.floor(m / 10), m % 10,
    Math.floor(s / 10), s % 10,
  ];
}

export function nixieCanvasSize(doc?: Document | null): { w: number; h: number } {
  let root = doc ?? (typeof document !== "undefined" ? document : null);
  try {
    if (!doc && typeof parent !== "undefined" && parent.document) root = parent.document;
  } catch { /* sandbox */ }
  const canvas = (root?.querySelector?.("canvas.render-host")
    ?? root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return {
    w: w > 64 ? w : CANVAS_DEFAULT.w,
    h: h > 64 ? h : CANVAS_DEFAULT.h,
  };
}

function nixiePair(n: number): string {
  const v = Math.max(0, Math.min(99, n));
  return `${Math.floor(v / 10)}${v % 10}`.padStart(2, "0");
}

export function nixieClockParts(
  date: Date,
  hour12: boolean,
  scratch: { h: number; m: number; s: number },
): void {
  let h = date.getHours();
  scratch.m = date.getMinutes();
  scratch.s = date.getSeconds();
  if (hour12) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  scratch.h = h;
}

/** Build a fallback line; caller owns scratch + cache (one closure per tile). */
export function formatNixieFallbackLine(
  date: Date,
  look: NixieLook,
  scratch: { h: number; m: number; s: number },
  cache: { key: number; text: string },
): string {
  nixieClockParts(date, look.hour12, scratch);
  const key = ((scratch.h * 3600 + scratch.m * 60 + (look.seconds ? scratch.s : 0)) << 2)
    | (look.hour12 ? 2 : 0)
    | (look.seconds ? 1 : 0);
  if (key === cache.key) return cache.text;
  cache.key = key;
  const parts = [nixiePair(scratch.h), nixiePair(scratch.m)];
  if (look.seconds) parts.push(nixiePair(scratch.s));
  cache.text = parts.join(" ");
  return cache.text;
}

export function packNixieBuffer(
  date: Date,
  look: NixieLook,
  audio = 0,
  pulse = 0,
  canvas: { w: number; h: number } = CANVAS_DEFAULT,
): number[] {
  const d = digitsOf(date, look.hour12);
  const blink = date.getMilliseconds() < 500 ? 1 : 0;
  const w = canvas.w > 64 ? canvas.w : CANVAS_DEFAULT.w;
  const h = canvas.h > 64 ? canvas.h : CANVAS_DEFAULT.h;
  return [
    d[0], d[1], d[2], d[3], d[4], d[5],
    blink, look.seconds ? 1 : 0, look.glow, look.flicker,
    clamp(audio, 0, 1), w, h, look.hour12 ? 1 : 0,
    clamp(pulse, 0, 1),
  ];
}
