/**
 * Pure pixel analysis over one small downscaled webcam frame. No DOM, no three: this runs inside the
 * camera worker (`cam.worker.ts`) as well as on the main-thread fallback, so every consumer of the
 * camera (gaze, live colour, live luma) reads the same frame instead of grabbing its own.
 */

/** Analysis frame size. Small enough that a full pass is well under a millisecond. */
export const SAMPLE_W = 96;
export const SAMPLE_H = 54;
/** How often the worker analyses a frame. Gaze used to poll at 30 Hz; 15 is plenty for a camera orbit. */
export const SAMPLE_HZ = 15;

export interface LookHit {
  /** +x is the right of the screen (selfie-mirrored), +y is up; both in [-1, 1] */
  x: number;
  y: number;
  /** 0 when there is no face; up to 1 with two dark pupils found */
  conf: number;
}

export interface CamSample {
  /** performance.now() on the thread that produced it */
  at: number;
  /** face / pupil estimate, or null when nothing skin-like is in frame */
  gaze: LookHit | null;
  /** highest-chroma hue in the frame as packed RGB, or 0 when the picture is dark / grey */
  chroma: number;
  /** mean WCAG relative luminance 0–1 */
  luma: number;
}

/** Same sRGB → linear WCAG luminance as `core/themes.relativeLuminance`, on raw 0–255 channels. */
function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Mean relative luminance of an RGBA buffer. */
export function meanLuma(pix: Uint8ClampedArray | Uint8Array): number {
  let s = 0, n = 0;
  for (let i = 0; i + 2 < pix.length; i += 4) {
    s += 0.2126 * linear(pix[i]!) + 0.7152 * linear(pix[i + 1]!) + 0.0722 * linear(pix[i + 2]!);
    n++;
  }
  return n ? s / n : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 40 || y > 245) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr > 133 && cr < 178 && cb > 77 && cb < 132 && r > g && g > b * 0.7;
}

/**
 * Face / pupil finder on a mirrored frame: a skin-chroma blob, then the two darkest spots in the eye band.
 * Returns null when there is no plausible face.
 */
export function findLook(pix: Uint8ClampedArray | Uint8Array, w: number, h: number): LookHit | null {
  let sx = 0, sy = 0, n = 0;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = pix[i]!, g = pix[i + 1]!, b = pix[i + 2]!;
      if (!isSkin(r, g, b)) continue;
      sx += x; sy += y; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (n < 40) return null;
  const fw = maxX - minX + 1, fh = maxY - minY + 1;
  if (fw < 12 || fh < 10) return null;
  const cx = sx / n, cy = sy / n;
  const eyeTop = minY + fh * 0.08;
  const eyeBot = minY + fh * 0.48;
  const eyeLeft = minX + fw * 0.08;
  const eyeRight = minX + fw * 0.92;
  let darkL = 0, darkR = 0, lx = 0, ly = 0, rx = 0, ry = 0;
  for (let y = eyeTop; y < eyeBot; y++) {
    for (let x = eyeLeft; x < eyeRight; x++) {
      const i = (Math.floor(y) * w + Math.floor(x)) * 4;
      const lum = pix[i]! * 0.3 + pix[i + 1]! * 0.59 + pix[i + 2]! * 0.11;
      if (lum > 70) continue;
      const wgt = (80 - lum) / 80;
      if (x < cx) { lx += x * wgt; ly += y * wgt; darkL += wgt; }
      else { rx += x * wgt; ry += y * wgt; darkR += wgt; }
    }
  }
  let px: number, py: number, conf: number;
  if (darkL > 4 && darkR > 4) {
    px = (lx / darkL + rx / darkR) * 0.5;
    py = (ly / darkL + ry / darkR) * 0.5;
    conf = Math.min(1, (darkL + darkR) / 80);
  } else {
    px = cx;
    py = cy - fh * 0.12;
    conf = Math.min(0.55, n / 400);
  }
  const x = clamp((px / w - 0.5) * 2.4, -1, 1);
  const y = clamp((0.42 - py / h) * 2.2, -1, 1);
  return { x, y, conf };
}

const HUE_BINS = 24;

/** Highest-chroma hue in the frame, pushed to a usable accent lightness. Greys and near-black do not count. */
export function dominantChroma(img: { data: Uint8ClampedArray | Uint8Array }): number {
  const pix = img.data;
  const mass = new Float32Array(HUE_BINS);
  const hr = new Float32Array(HUE_BINS), hg = new Float32Array(HUE_BINS), hb = new Float32Array(HUE_BINS);
  for (let i = 0; i < pix.length; i += 4) {
    const r = pix[i]!, g = pix[i + 1]!, b = pix[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 510;
    if (d < 18 || l < 0.12 || l > 0.92) continue;
    const s = d / (255 - Math.abs(max + min - 255));
    if (s < 0.18) continue;
    let h = 0;
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    const bin = Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS));
    const w = s * (1 - Math.abs(l - 0.5) * 1.4);
    mass[bin] += w;
    hr[bin] += r * w; hg[bin] += g * w; hb[bin] += b * w;
  }
  let best = 0, bi = -1;
  for (let i = 0; i < HUE_BINS; i++) if (mass[i]! > best) { best = mass[i]!; bi = i; }
  if (bi < 0 || best < 4) return 0;
  const r = hr[bi]! / best, g = hg[bi]! / best, b = hb[bi]! / best;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/** Everything the consumers need from one frame. */
export function analyzeFrame(pix: Uint8ClampedArray | Uint8Array, w: number, h: number, at: number): CamSample {
  return {
    at,
    gaze: findLook(pix, w, h),
    chroma: dominantChroma({ data: pix }),
    luma: meanLuma(pix),
  };
}
