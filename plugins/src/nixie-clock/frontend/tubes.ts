export type NixieLook = {
  hour12: boolean;
  seconds: boolean;
  glow: number;
  flicker: number;
};

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

export function parseNixieLook(cfg?: Record<string, string> | null): NixieLook {
  const seconds = cfg?.seconds;
  const glow = Number(cfg?.glow);
  const flicker = Number(cfg?.flicker);
  return {
    hour12: cfg?.format === "12",
    seconds: seconds !== "0" && seconds !== "false",
    glow: clamp(Number.isFinite(glow) ? glow : DEFAULT_LOOK.glow, 0.4, 1.6),
    flicker: clamp(Number.isFinite(flicker) ? flicker : DEFAULT_LOOK.flicker, 0, 1),
  };
}

export function digitsOf(date: Date, hour12: boolean): [number, number, number, number, number, number] {
  let h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  if (hour12) {
    h = h % 12;
    if (h === 0) h = 12;
  }
  return [
    Math.floor(h / 10), h % 10,
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

/** Slot 0: six digits + colon blink + look + canvas + LAN pulse. */
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
