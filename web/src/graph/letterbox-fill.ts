/** Letterbox bar fill from the scene surface (backdrop clear + grain), never flat black. */
export type SurfaceLetterboxFill = {
  css: string;
  /** 0–1 grain strength mixed into bar fill */
  grain: number;
};

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
  return { css, grain: Math.min(1, Math.max(0, grain)) };
}

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

/** Hot-path fill: one instance per `clearHex`, rebuilt only when the scene clear changes. */
export function getSurfaceLetterboxFill(clearHex: number, grain = 0.25): SurfaceLetterboxFill {
  if (cachedClearHex === clearHex && cachedFill) return cachedFill;
  letterboxFillStats.rebuilds += 1;
  cachedClearHex = clearHex;
  cachedFill = surfaceLetterboxFill(clearHex, grain);
  return cachedFill;
}

export function clearSurfaceLetterboxFillCache(): void {
  cachedClearHex = -1;
  cachedFill = null;
}

export function letterboxFillHex(fill: SurfaceLetterboxFill): number {
  const m = fill.css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return 0x010101;
  return (parseInt(m[1], 10) << 16) | (parseInt(m[2], 10) << 8) | parseInt(m[3], 10);
}

export function isBlackFill(css: string): boolean {
  const t = css.replace(/\s/g, "").toLowerCase();
  return t === "#000" || t === "#000000" || t === "rgb(0,0,0)" || t === "black";
}

/** Paint letterbox bars inside `box` around `inner` using surface colour + light grain. */
export function paintLetterboxBars(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
  fill: SurfaceLetterboxFill,
): void {
  if (isBlackFill(fill.css)) return;
  ctx.save();
  ctx.fillStyle = fill.css;
  const bars = [
    { x: box.x, y: box.y, w: box.w, h: Math.max(0, inner.y - box.y) },
    { x: box.x, y: inner.y + inner.h, w: box.w, h: Math.max(0, box.y + box.h - inner.y - inner.h) },
    { x: box.x, y: inner.y, w: Math.max(0, inner.x - box.x), h: inner.h },
    { x: inner.x + inner.w, y: inner.y, w: Math.max(0, box.x + box.w - inner.x - inner.w), h: inner.h },
  ];
  for (const b of bars) {
    if (b.w < 1 || b.h < 1) continue;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (fill.grain > 0.01) {
      const n = Math.min(120, Math.floor(b.w * b.h * 0.02));
      for (let i = 0; i < n; i++) {
        const px = b.x + Math.random() * b.w;
        const py = b.y + Math.random() * b.h;
        ctx.fillStyle = `rgba(255,255,255,${(0.04 + fill.grain * 0.08) * Math.random()})`;
        ctx.fillRect(px, py, 1, 1);
      }
      ctx.fillStyle = fill.css;
    }
  }
  ctx.restore();
}

export function letterboxInnerRect(
  box: { w: number; h: number },
  contentAspect: number,
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
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

export function letterboxInnerRectInto(
  box: { w: number; h: number },
  contentAspect: number,
  out: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const inner = letterboxInnerRect(box, contentAspect);
  out.x = inner.x;
  out.y = inner.y;
  out.w = inner.w;
  out.h = inner.h;
  return out;
}
