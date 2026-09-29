/** CPU picture of the fluid tank for browsers that cannot create a WebGL context. */

export interface SoftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const N = 10;
const CELLS = N * N;
const ORIGIN = 64;

function at(slot: (buffer: number, index: number) => number, i: number): number {
  const b = Math.floor(i / 64);
  const f = i - b * 64;
  return slot(b, f) || 0;
}

function cell(slot: (buffer: number, index: number) => number, base: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(N - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(N - 1, Math.floor(y)));
  const x1 = Math.min(N - 1, x0 + 1);
  const y1 = Math.min(N - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const s = (ix: number, iy: number) => at(slot, base + iy * N + ix);
  const a = s(x0, y0) * (1 - fx) + s(x1, y0) * fx;
  const b = s(x0, y1) * (1 - fx) + s(x1, y1) * fx;
  return a * (1 - fy) + b * fy;
}

function mix(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function solid(p: number, q: number, kind: number, rad: number, cx: number, cy: number): boolean {
  if (kind < 0.5 || rad < 0.001) return false;
  if (kind < 1.5) {
    const dx = p - cx;
    const dy = q - cy;
    return dx * dx + dy * dy < rad * rad;
  }
  if (kind < 2.5) {
    const dx = (p - cx) / Math.max(0.02, rad * 1.7);
    const dy = (q - cy) / Math.max(0.02, rad * 0.42);
    return dx * dx + dy * dy < 1;
  }
  if (kind < 3.5) {
    const r = Math.max(0.03, rad * 0.55);
    for (let k = -1; k <= 1; k++) {
      const dx = p - (cx + k * 0.2);
      const dy = q - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }
  return Math.abs(p - cx) < 0.04 && Math.abs(q - cy) >= rad * 0.7;
}

/** 0..1 rgb. Palette ids match the sky shader. */
export function fluidRgb(
  density: number,
  hue: number,
  palette: number,
  gamma: number,
): [number, number, number] {
  const d = Math.pow(Math.max(0, Math.min(1, density)), Math.max(0.35, gamma || 0.85));
  const h = hue * Math.PI * 2;
  const ink: [number, number, number] = [
    0.55 * 0.28 + 0.45 * (0.5 + 0.5 * Math.cos(h)),
    0.55 * 0.16 + 0.45 * (0.5 + 0.5 * Math.cos(h + 2.1)),
    0.55 * 0.42 + 0.45 * (0.5 + 0.5 * Math.cos(h + 4.2)),
  ];
  let r = mix(0.93, ink[0], d);
  let g = mix(0.9, ink[1], d);
  let b = mix(0.84, ink[2], d);
  if (palette > 0.5) {
    r = mix(0.02, 0.35, d);
    g = mix(0.07, 0.85, d);
    b = mix(0.16, 0.95, d);
  }
  if (palette > 1.5) {
    r = mix(0.05, 1, d);
    g = mix(0.02, 0.42, d);
    b = mix(0.02, 0.08, d);
  }
  if (palette > 2.5) {
    r = mix(0.05, 1, d);
    g = mix(0.15, 0.85, d);
    b = mix(0.85, 0.2, d);
    if (d > 0.72) {
      const k = Math.min(1, (d - 0.72) / 0.28);
      r = mix(r, 0.9, k);
      g = mix(g, 0.15, k);
      b = mix(b, 0.1, k);
    }
  }
  if (palette > 3.5) {
    r = mix(0.03, 0.1, d);
    g = mix(0.02, 0.95, d);
    b = mix(0.07, 0.85, d);
  }
  if (palette > 4.5) {
    r = mix(0.96, 0.08, d);
    g = mix(0.96, 0.08, d);
    b = mix(0.95, 0.1, d);
  }
  return [r, g, b];
}

function fallbackDye(x: number, y: number, time: number): number {
  const cx = 0.5;
  const cy = 0.58;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const arm = Math.sin(ang * 3 - time * 1.2 + r * 16);
  const band = arm < 0.2 ? 0 : arm > 0.85 ? 1 : (arm - 0.2) / 0.65;
  return Math.exp(-r * r * 14) * 0.95 + band * Math.exp(-r * 3.5) * 0.55;
}

export function fluidSample(
  slot: (buffer: number, index: number) => number,
  x: number,
  y: number,
  time: number,
): [number, number, number] {
  const mark = at(slot, 0);
  const pal = at(slot, 2);
  const gamma = at(slot, 12) || 0.85;
  if (mark < 0.5) return fluidRgb(fallbackDye(x, y, time), 0.72, 0, 0.85);
  const kind = at(slot, 3);
  const rad = at(slot, 4);
  const ox = at(slot, 5);
  const oy = at(slot, 6);
  if (solid(x, y, kind, rad, ox, oy)) return [0.1, 0.11, 0.13];
  const cellXy = { x: x * (N - 1), y: y * (N - 1) };
  const dye = cell(slot, ORIGIN, cellXy.x, cellXy.y);
  const hue = cell(slot, ORIGIN + CELLS, cellXy.x, cellXy.y);
  const shade = at(slot, 1);
  let shown = dye;
  if (shade > 0.5 && shade < 1.5) {
    const vx = cell(slot, ORIGIN + CELLS * 2, cellXy.x, cellXy.y);
    const vy = cell(slot, ORIGIN + CELLS * 3, cellXy.x, cellXy.y);
    shown = Math.min(1, Math.hypot(vx, vy) / 2.2);
  }
  return fluidRgb(shown, hue, pal, gamma);
}

export function paintSoftwareFluid(
  ctx: CanvasRenderingContext2D,
  rect: SoftRect,
  slot: (buffer: number, index: number) => number,
  time: number,
): void {
  if (rect.w < 2 || rect.h < 2) return;
  const maxW = 240;
  const scale = Math.min(1, maxW / rect.w);
  const w = Math.max(2, Math.round(rect.w * scale));
  const h = Math.max(2, Math.round(rect.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const pen = canvas.getContext("2d");
  if (!pen) return;
  const img = pen.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    const py = 1 - (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / w;
      const [r, g, b] = fluidSample(slot, px, py, time);
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(r * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      data[i + 3] = 255;
    }
  }
  pen.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}
