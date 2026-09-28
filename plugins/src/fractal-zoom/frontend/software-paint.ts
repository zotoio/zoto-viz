/** CPU picture of the fractal sky for browsers that cannot create a WebGL context. */

import {
  CANYON_HOME,
  ORBIT_MAX,
  SEAHORSE_X,
  SEAHORSE_Y,
  type Cruise2,
  type DeParams,
  type EscapeSample,
  de3,
  escape2,
  steerEdge,
  stepCanyon,
  windowScale,
} from "./cruise";
import { FZ_SLOT } from "./drive";

export interface SoftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function mix(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Same cosine palettes as the sky shader. */
export function fractalPalette(t: number, pal: number, hue: number, sat: number): [number, number, number] {
  let r = 0.12;
  let g = 0.18;
  let b = 0.42;
  const lay = (er: number, eg: number, eb: number, a: number, c: number) => {
    const k = smooth(a, c, pal);
    r = mix(r, er, k);
    g = mix(g, eg, k);
    b = mix(b, eb, k);
  };
  lay(0.9, 0.25, 0.08, 0.5, 1.5);
  lay(0.95, 0.45, 0.12, 1.5, 2.5);
  lay(0.2, 0.95, 0.55, 2.5, 3.5);
  lay(0.95, 0.2, 0.75, 3.5, 4.5);
  lay(0.55, 0.85, 1.0, 4.5, 5.5);
  lay(1.0, 0.35, 0.15, 5.5, 6.5);
  lay(0.15, 0.75, 0.95, 6.5, 7.5);
  const h = hue * Math.PI * 2;
  const gray = (r + g + b) / 3;
  r = mix(gray, r, sat);
  g = mix(gray, g, sat);
  b = mix(gray, b, sat);
  const tone = (ch: number, phase: number) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (ch + t + phase + h));
  return [tone(r, 0), tone(g, 0.33), tone(b, 0.67)];
}

function sampleColor(sample: EscapeSample, iterCap: number, spin: number, pal: number, hue: number, sat: number): [number, number, number] {
  if (!sample.escaped) {
    const trap = Math.log(sample.trap + 1);
    return fractalPalette(spin + trap * 0.22, pal, hue, sat).map((c) => c * 0.62) as [number, number, number];
  }
  const esc = sample.n / Math.max(8, iterCap);
  const col = fractalPalette(spin + esc * 2.5, pal, hue, sat);
  const gain = 0.35 + Math.min(1.4, esc * 1.4);
  return [col[0] * gain, col[1] * gain, col[2] * gain];
}

let fallback: Cruise2 = { x: SEAHORSE_X, y: SEAHORSE_Y, vx: 0, vy: 0, heading: 0.7 };
let fallbackLog = -0.35;
let fallbackT = 0;
let fallback3 = { ...CANYON_HOME };

function readOrbit(
  slot: (buffer: number, index: number) => number,
  len: number,
): Array<[number, number]> {
  const n = Math.max(0, Math.min(ORBIT_MAX, len | 0));
  const zs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const f = i * 2;
    const buffer = 1 + Math.floor(f / 64);
    const local = f - Math.floor(f / 64) * 64;
    zs.push([slot(buffer, local) ?? 0, slot(buffer, local + 1) ?? 0]);
  }
  return zs;
}

function perturbPixel(
  orbit: ReadonlyArray<readonly [number, number]>,
  dcx: number,
  dcy: number,
  julia: boolean,
): EscapeSample {
  let dx = julia ? dcx : 0;
  let dy = julia ? dcy : 0;
  let trap = 1e9;
  const cap = Math.min(orbit.length, 72);
  for (let i = 0; i < cap; i++) {
    const Z = orbit[i]!;
    const zx = Z[0] + dx;
    const zy = Z[1] + dy;
    const mag = zx * zx + zy * zy;
    if (mag < trap) trap = mag;
    if (mag > 64 && i > 0) {
      return { n: i + 1 - Math.log2(Math.log2(Math.max(mag, 1.0001))), trap, escaped: true };
    }
    const ndx = 2 * (Z[0] * dx - Z[1] * dy) + (dx * dx - dy * dy) + (julia ? 0 : dcx);
    const ndy = 2 * (Z[0] * dy + Z[1] * dx) + 2 * dx * dy + (julia ? 0 : dcy);
    dx = ndx;
    dy = ndy;
  }
  return { n: cap, trap, escaped: false };
}

/**
 * Raster the live fractal. Slot 0 is the drive buffer; when it is empty, a local
 * canyon cruise keeps the picture moving.
 */
export function paintSoftwareFractal(
  ctx: CanvasRenderingContext2D,
  rect: SoftRect,
  slot: (buffer: number, index: number) => number,
  time: number,
): void {
  const mark = slot(0, FZ_SLOT.mark);
  const dt = Math.min(0.05, Math.max(0, time - fallbackT));
  fallbackT = time;
  let cx: number;
  let cy: number;
  let scale: number;
  let typ: number;
  let pal: number;
  let spin: number;
  let hue: number;
  let sat: number;
  let iterCap: number;
  let julia = false;
  let jx = 0;
  let jy = 0;
  if (mark > 0.5) {
    cx = slot(0, FZ_SLOT.mandelCx);
    cy = slot(0, FZ_SLOT.mandelCy);
    scale = Math.max(1e-20, slot(0, FZ_SLOT.mandelScale));
    typ = slot(0, FZ_SLOT.fractalType);
    pal = slot(0, FZ_SLOT.palette);
    spin = slot(0, FZ_SLOT.paletteCycle) * time * 0.22;
    hue = slot(0, FZ_SLOT.hue);
    sat = slot(0, FZ_SLOT.sat);
    iterCap = Math.max(16, Math.round(slot(0, FZ_SLOT.maxIterN) * 96));
    julia = typ >= 6.5;
    jx = slot(0, FZ_SLOT.juliaCr);
    jy = slot(0, FZ_SLOT.juliaCi);
  } else {
    const sc = windowScale(fallbackLog, rect.w / Math.max(1, rect.h));
    fallback = steerEdge(fallback, sc, dt || 1 / 60, 48);
    fallbackLog += (dt || 1 / 60) * 0.35;
    fallback3 = stepCanyon(fallback3, dt || 1 / 60, 0, {
      power: 8, scale: 2.1, fold: 0.55, sym: 6, jx: -0.745, jy: 0.186, jz: 0.12, jw: 0.08,
    }, fallbackLog);
    cx = fallback.x;
    cy = fallback.y;
    scale = windowScale(fallbackLog, rect.w / Math.max(1, rect.h));
    typ = 6;
    pal = 6;
    spin = 0.25 * time * 0.22;
    hue = 0;
    sat = 1;
    iterCap = 48;
  }

  const maxW = typ < 6 ? 112 : 240;
  const pw = Math.max(16, Math.min(maxW, Math.floor(rect.w)));
  const ph = Math.max(16, Math.floor(pw * (rect.h / Math.max(1, rect.w))));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(pw, ph);
  const data = img.data;
  const orbitLen = mark > 0.5 ? slot(0, FZ_SLOT.orbitLen) : 0;
  const orbit = orbitLen > 8 ? readOrbit(slot, orbitLen) : [];
  const usePerturb = orbit.length > 8 && scale < 0.02;
  const bgR = mark > 0.5 ? slot(0, FZ_SLOT.bgR) : 0.02;
  const bgG = mark > 0.5 ? slot(0, FZ_SLOT.bgG) : 0.04;
  const bgB = mark > 0.5 ? slot(0, FZ_SLOT.bgB) : 0.09;

  if (typ < 6) {
    paintVolume(data, pw, ph, slot, mark, time, pal, spin, hue, sat, bgR, bgG, bgB);
  } else {
    const aspect = pw / ph;
    const juliaC = julia ? { x: jx, y: jy } : undefined;
    for (let y = 0; y < ph; y++) {
      const uvy = (0.5 - (y + 0.5) / ph) * 2 * 0.9;
      for (let x = 0; x < pw; x++) {
        const uvx = ((x + 0.5) / pw - 0.5) * 2 * aspect * 0.9;
        const dcx = uvx * scale;
        const dcy = uvy * scale;
        const sample = usePerturb
          ? perturbPixel(orbit, dcx, dcy, julia)
          : escape2(cx + dcx, cy + dcy, Math.min(64, iterCap), juliaC);
        const col = sampleColor(sample, iterCap, spin, pal, hue, sat);
        const o = (y * pw + x) * 4;
        data[o] = Math.max(0, Math.min(255, (col[0] * 0.92 + bgR * 0.08) * 255));
        data[o + 1] = Math.max(0, Math.min(255, (col[1] * 0.92 + bgG * 0.08) * 255));
        data[o + 2] = Math.max(0, Math.min(255, (col[2] * 0.92 + bgB * 0.08) * 255));
        data[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h);
}

function paintVolume(
  data: Uint8ClampedArray,
  pw: number,
  ph: number,
  slot: (buffer: number, index: number) => number,
  mark: number,
  time: number,
  pal: number,
  spin: number,
  hue: number,
  sat: number,
  bgR: number,
  bgG: number,
  bgB: number,
): void {
  const params: DeParams = mark > 0.5
    ? {
      power: slot(0, FZ_SLOT.power) || 8,
      scale: slot(0, FZ_SLOT.scale) || 2.1,
      fold: slot(0, FZ_SLOT.fold) || 0.55,
      sym: slot(0, FZ_SLOT.kaleidoSym) || 6,
      jx: slot(0, FZ_SLOT.juliaCr),
      jy: slot(0, FZ_SLOT.juliaCi),
      jz: slot(0, FZ_SLOT.quatC2),
      jw: slot(0, FZ_SLOT.quatC3),
    }
    : { power: 8, scale: 2.1, fold: 0.55, sym: 6, jx: -0.745, jy: 0.186, jz: 0.12, jw: 0.08 };
  const kind = mark > 0.5 ? slot(0, FZ_SLOT.fractalType) : 0;
  const fx = mark > 0.5 ? slot(0, FZ_SLOT.focusX) : fallback3.fx;
  const fy = mark > 0.5 ? slot(0, FZ_SLOT.focusY) : fallback3.fy;
  const fz = mark > 0.5 ? slot(0, FZ_SLOT.focusZ) : fallback3.fz;
  const useFocus = Math.hypot(fx, fy, fz) > 1e-4;
  const focusX = useFocus ? fx : fallback3.fx;
  const focusY = useFocus ? fy : fallback3.fy;
  const focusZ = useFocus ? fz : fallback3.fz;
  const cx = mark > 0.5 ? slot(0, FZ_SLOT.camX) : fallback3.cx;
  const cy = mark > 0.5 ? slot(0, FZ_SLOT.camY) : fallback3.cy;
  const cz = mark > 0.5 ? slot(0, FZ_SLOT.camZ) : fallback3.cz;
  let lx = focusX - cx;
  let ly = focusY - cy;
  let lz = focusZ - cz;
  const ll = Math.hypot(lx, ly, lz) || 1;
  lx /= ll; ly /= ll; lz /= ll;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(ly) > 0.9) { ux = 1; uy = 0; uz = 0; }
  let rx = ly * uz - lz * uy;
  let ry = lz * ux - lx * uz;
  let rz = lx * uy - ly * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  ux = ry * lz - rz * ly;
  uy = rz * lx - rx * lz;
  uz = rx * ly - ry * lx;
  const zoom = mark > 0.5 ? Math.exp(Math.min(8, Math.max(0, slot(0, FZ_SLOT.zoomLog) + 0.35)) * 0.45) : 1 + (time % 12) * 0.08;
  const spread = 0.85 / zoom;
  for (let y = 0; y < ph; y++) {
    const v = (0.5 - (y + 0.5) / ph) * spread;
    for (let x = 0; x < pw; x++) {
      const u = ((x + 0.5) / pw - 0.5) * (pw / ph) * spread;
      let dx = lx + rx * u + ux * v;
      let dy = ly + ry * u + uy * v;
      let dz = lz + rz * u + uz * v;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      let t = 0.02;
      let hit = 0;
      let shade = 0.2;
      for (let s = 0; s < 18; s++) {
        const d = de3(kind, cx + dx * t, cy + dy * t, cz + dz * t, params);
        if (d < 0.012 * (1 + t)) {
          hit = 1;
          shade = 0.35 + 0.65 * Math.min(1, s / 14);
          break;
        }
        t += Math.max(d, 0.01);
        if (t > 8) break;
      }
      const col = fractalPalette(spin + t * 0.15, pal, hue, sat);
      const k = hit ? shade : Math.exp(-t * 0.35) * 0.45;
      const o = (y * pw + x) * 4;
      data[o] = Math.min(255, (bgR + col[0] * k) * 255);
      data[o + 1] = Math.min(255, (bgG + col[1] * k) * 255);
      data[o + 2] = Math.min(255, (bgB + col[2] * k) * 255);
      data[o + 3] = 255;
    }
  }
}
