/** Letterbox bar fill from the scene surface (backdrop clear + grain), never flat black. */
export type SurfaceLetterboxFill = {
  css: string;
  /** 0–1 grain strength mixed into bar fill */
  grain: number;
  /** Packed RGB for Three.js `setClearColor` (avoids per-frame css parse). */
  hex: number;
  /** Baked 2D grain for software letterbox bars (fixed seed). */
  pattern: CanvasPattern | null;
};

export const letterboxFillStats = {
  rebuilds: 0,
  regexMatchCalls: 0,
  randomCalls: 0,
  stringAllocations: 0,
  reset(): void {
    this.rebuilds = 0;
    this.regexMatchCalls = 0;
    this.randomCalls = 0;
    this.stringAllocations = 0;
  },
};

let cachedClearHex = -1;
let cachedFill: SurfaceLetterboxFill | null = null;

/** Test harness: drop cached fill (import via `web/test-support/letterbox-fill-cache.ts`). */
export function clearSurfaceLetterboxFillCache(): void {
  cachedClearHex = -1;
  cachedFill = null;
}

/** Fixed-seed PRNG for repeatable grain tiles (Mulberry32). */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = t >>> 0;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildGrainPattern(hex: number, grain: number): CanvasPattern | null {
  if (grain <= 0.01) return null;
  const tile = document.createElement("canvas");
  tile.width = 64;
  tile.height = 64;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  letterboxFillStats.stringAllocations += 1;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 64, 64);
  const rand = mulberry32((hex ^ 0x5a5a5a5a) >>> 0);
  const n = 180;
  for (let i = 0; i < n; i++) {
    letterboxFillStats.randomCalls += 1;
    const px = rand() * 64;
    letterboxFillStats.randomCalls += 1;
    const py = rand() * 64;
    letterboxFillStats.randomCalls += 1;
    const a = (0.04 + grain * 0.08) * rand();
    letterboxFillStats.stringAllocations += 1;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(px, py, 1, 1);
  }
  return ctx.createPattern(tile, "repeat");
}

export function surfaceLetterboxFill(clearHex: number, grain = 0.25): SurfaceLetterboxFill {
  let r = (clearHex >> 16) & 255;
  let g = (clearHex >> 8) & 255;
  let b = clearHex & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 18) {
    const lift = (18 - lum) / 255;
    r = Math.min(255, Math.round(r + lift * 255));
    g = Math.min(255, Math.round(g + lift * 255));
    b = Math.min(255, Math.round(b + lift * 255));
  }
  const css = `rgb(${r}, ${g}, ${b})`;
  letterboxFillStats.stringAllocations += 1;
  const hex = (r << 16) | (g << 8) | b;
  const gNorm = Math.min(1, Math.max(0, grain));
  return {
    css,
    grain: gNorm,
    hex,
    pattern: buildGrainPattern(hex, gNorm),
  };
}

/** Hot-path fill: one instance per `clearHex`, rebuilt only when the scene clear changes. */
export function getSurfaceLetterboxFill(clearHex: number, grain = 0.25): SurfaceLetterboxFill {
  if (cachedClearHex === clearHex && cachedFill) return cachedFill;
  letterboxFillStats.rebuilds += 1;
  cachedClearHex = clearHex;
  cachedFill = surfaceLetterboxFill(clearHex, grain);
  return cachedFill;
}

export function letterboxFillHex(fill: SurfaceLetterboxFill): number {
  return fill.hex;
}

export function isBlackFillHex(hex: number): boolean {
  return hex === 0 || hex === 0x000000;
}

export type LetterboxBarRect = { x: number; y: number; w: number; h: number };

/** Paint letterbox bars inside `box` around `inner` using surface colour + baked grain pattern. */
export function paintLetterboxBarsInto(
  ctx: CanvasRenderingContext2D,
  box: LetterboxBarRect,
  inner: LetterboxBarRect,
  fill: SurfaceLetterboxFill,
  bars: [LetterboxBarRect, LetterboxBarRect, LetterboxBarRect, LetterboxBarRect],
): void {
  if (isBlackFillHex(fill.hex)) return;
  bars[0].x = box.x;
  bars[0].y = box.y;
  bars[0].w = box.w;
  bars[0].h = Math.max(0, inner.y - box.y);
  bars[1].x = box.x;
  bars[1].y = inner.y + inner.h;
  bars[1].w = box.w;
  bars[1].h = Math.max(0, box.y + box.h - inner.y - inner.h);
  bars[2].x = box.x;
  bars[2].y = inner.y;
  bars[2].w = Math.max(0, inner.x - box.x);
  bars[2].h = inner.h;
  bars[3].x = inner.x + inner.w;
  bars[3].y = inner.y;
  bars[3].w = Math.max(0, box.x + box.w - inner.x - inner.w);
  bars[3].h = inner.h;
  ctx.save();
  ctx.fillStyle = fill.pattern ?? fill.css;
  for (const b of bars) {
    if (b.w < 1 || b.h < 1) continue;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.restore();
}

/** @deprecated Use `paintLetterboxBarsInto` with scratch bars. */
export function paintLetterboxBars(
  ctx: CanvasRenderingContext2D,
  box: LetterboxBarRect,
  inner: LetterboxBarRect,
  fill: SurfaceLetterboxFill,
): void {
  const bars = [
    { x: 0, y: 0, w: 0, h: 0 },
    { x: 0, y: 0, w: 0, h: 0 },
    { x: 0, y: 0, w: 0, h: 0 },
    { x: 0, y: 0, w: 0, h: 0 },
  ] as [LetterboxBarRect, LetterboxBarRect, LetterboxBarRect, LetterboxBarRect];
  paintLetterboxBarsInto(ctx, box, inner, fill, bars);
}

export function letterboxInnerRectInto(
  box: { w: number; h: number },
  contentAspect: number,
  out: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const bw = box.w;
  const bh = box.h;
  const a = contentAspect > 0 ? contentAspect : bw / bh;
  let w = bw;
  let h = w / a;
  if (h > bh) {
    h = bh;
    w = h * a;
  }
  out.x = (bw - w) / 2;
  out.y = (bh - h) / 2;
  out.w = w;
  out.h = h;
  return out;
}
