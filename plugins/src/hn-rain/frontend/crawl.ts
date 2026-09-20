/** HN Rain ticker look — packed into the sky buffer ahead of the glyph stream. */

export const HN_RAIN_HEADER = 9;
export const HN_RAIN_MAX_CHARS = 55;
export const HN_RAIN_TILT_DEFAULT = 8;
export const HN_RAIN_TYPE_DEFAULT = 50;
export const HN_RAIN_PACE_DEFAULT = 1;
export const HN_RAIN_TILT_MIN = -20;
export const HN_RAIN_TILT_MAX = 20;
export const HN_RAIN_TYPE_MIN = 28;
export const HN_RAIN_TYPE_MAX = 96;
export const HN_RAIN_PACE_MIN = 0.25;
export const HN_RAIN_PACE_MAX = 3;
export const HN_RAIN_CANVAS_DEFAULT = { w: 1280, h: 800 };

export type HnRainLook = {
  /** dy/dx slope of the crawl (tan of degrees). */
  tilt: number;
  /** Glyph cell width in pixels. */
  type: number;
  /** Crawl scroll multiplier. */
  pace: number;
  /** Composer 2.5 stills for each title. */
  pics: boolean;
};

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function parseHnRainLook(cfg?: Record<string, string>): HnRainLook {
  const deg = clamp(Number(cfg?.tilt), HN_RAIN_TILT_MIN, HN_RAIN_TILT_MAX, HN_RAIN_TILT_DEFAULT);
  const type = clamp(Number(cfg?.type), HN_RAIN_TYPE_MIN, HN_RAIN_TYPE_MAX, HN_RAIN_TYPE_DEFAULT);
  const pace = clamp(Number(cfg?.pace), HN_RAIN_PACE_MIN, HN_RAIN_PACE_MAX, HN_RAIN_PACE_DEFAULT);
  const pics = cfg?.pics !== "0" && cfg?.pics !== "false";
  return { tilt: Math.tan((deg * Math.PI) / 180), type, pace, pics };
}

export function preferHnTitles(
  headlines: { id?: string; label?: string; text?: string }[],
): string[] {
  return headlines.map((h) => (h.text ?? "").trim()).filter(Boolean);
}

export function hnRainCanvasSize(doc?: Document | null): { w: number; h: number } {
  const root = doc ?? (typeof document !== "undefined" ? document : null);
  const canvas = (root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return {
    w: w > 64 ? w : HN_RAIN_CANVAS_DEFAULT.w,
    h: h > 64 ? h : HN_RAIN_CANVAS_DEFAULT.h,
  };
}

export function packHnRainBuffer(
  headlines: { id?: string; label?: string; text?: string }[],
  field: number,
  audio: number,
  look: HnRainLook = parseHnRainLook(),
  canvas: { w: number; h: number } = HN_RAIN_CANVAS_DEFAULT,
): number[] {
  const titles = preferHnTitles(headlines);
  const joined = (titles.join(" / ") || "HN RAIN").toUpperCase();
  const n = Math.min(HN_RAIN_MAX_CHARS, joined.length);
  const rw = canvas.w > 64 ? canvas.w : HN_RAIN_CANVAS_DEFAULT.w;
  const rh = canvas.h > 64 ? canvas.h : HN_RAIN_CANVAS_DEFAULT.h;
  const buf = [
    titles.length,
    n / 60,
    field,
    audio,
    look.tilt,
    look.type / 100,
    rw,
    rh,
    look.pace,
  ];
  for (let i = 0; i < n; i++) {
    const c = joined.charCodeAt(i);
    buf.push((c >= 32 && c < 127 ? c - 32 : 0) / 95);
  }
  return buf;
}
