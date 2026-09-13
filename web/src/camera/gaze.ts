import * as THREE from "three";

/**
 * Face / pupil tracker on the shared webcam (liveCam). Maps look to x,y in [-1, 1]:
 * +x is the right of the screen (the frame is mirrored so it matches a selfie view),
 * +y is up. No extra model: a skin-chroma blob, then the two darkest spots in the eye band.
 * `conf` is 0 when the camera is dark, denied, or the face is gone, so the orbit can ignore it.
 */

const W = 96;
const H = 54;

export class Gaze {
  x = 0;
  y = 0;
  conf = 0;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D | null;
  private cool = 0;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  /** Sample `video` about 30 Hz. When it is not ready, look and confidence ease back to rest. */
  tick(video: HTMLVideoElement | null, dt: number): void {
    this.cool -= dt;
    if (!video || video.readyState < 2 || video.videoWidth < 8) {
      this.decay(dt, 0);
      return;
    }
    if (this.cool > 0) return;
    this.cool = 1 / 30;
    const ctx = this.ctx;
    if (!ctx) {
      this.decay(dt, 0);
      return;
    }
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();
    const pix = ctx.getImageData(0, 0, W, H).data;
    const hit = findLook(pix, W, H);
    const k = Math.min(1, dt * 5);
    if (!hit) {
      this.decay(dt, 0);
      return;
    }
    this.x += (hit.x - this.x) * k;
    this.y += (hit.y - this.y) * k;
    this.conf += (hit.conf - this.conf) * k;
  }

  private decay(dt: number, conf: number): void {
    const k = Math.min(1, dt * 1.6);
    this.x += (0 - this.x) * k;
    this.y += (0 - this.y) * k;
    this.conf += (conf - this.conf) * k;
  }
}

function findLook(pix: Uint8ClampedArray, w: number, h: number): { x: number; y: number; conf: number } | null {
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
  const x = THREE.MathUtils.clamp((px / w - 0.5) * 2.4, -1, 1);
  const y = THREE.MathUtils.clamp((0.42 - py / h) * 2.2, -1, 1);
  return { x, y, conf };
}

function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 40 || y > 245) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr > 133 && cr < 178 && cb > 77 && cb < 132 && r > g && g > b * 0.7;
}
