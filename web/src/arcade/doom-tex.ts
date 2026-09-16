/**
 * Original 1993-FPS-style textures and sprites for CPU Doom.
 * Procedural canvases — not ripped from any WAD.
 */

export const TEX = 64;

export interface DoomArt {
  startan: HTMLCanvasElement;
  stone: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  ceil: HTMLCanvasElement;
  floorPix: Uint32Array;
  ceilPix: Uint32Array;
  imp: HTMLCanvasElement;
  baron: HTMLCanvasElement;
  rocket: HTMLCanvasElement;
  boom: HTMLCanvasElement;
  launcher: HTMLCanvasElement;
  gibs: HTMLCanvasElement[];
  blood: HTMLCanvasElement;
}

function hash(x: number, y: number, s = 1): number {
  let n = Math.imul(x + s * 17, 374761393) ^ Math.imul(y + s * 13, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function make(n = TEX): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return c.getContext("2d");
}

function pix(c: HTMLCanvasElement): Uint32Array {
  const g = ctx2d(c);
  if (!g) return new Uint32Array(TEX * TEX);
  return new Uint32Array(g.getImageData(0, 0, c.width, c.height).data.buffer);
}

function paintTex(shade: (x: number, y: number) => [number, number, number]): HTMLCanvasElement {
  const c = make();
  const g = ctx2d(c);
  if (!g) return c;
  const img = g.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const [r, gv, b] = shade(x, y);
      const i = (y * TEX + x) * 4;
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, gv));
      d[i + 2] = Math.max(0, Math.min(255, b));
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Tan tech-panel wall (STARTAN spirit). */
export function makeStartan(): HTMLCanvasElement {
  const c = paintTex((x, y) => {
    const n = hash(x, y, 3) * 18;
    return [168 + n, 132 + n * 0.6, 78 + n * 0.3];
  });
  const g = ctx2d(c);
  if (!g) return c;
  const panel = 16;
  for (let py = 0; py < TEX; py += panel) {
    for (let px = 0; px < TEX; px += panel) {
      g.fillStyle = "rgba(40,24,12,0.55)";
      g.fillRect(px, py, panel, 1);
      g.fillRect(px, py, 1, panel);
      g.fillStyle = "rgba(230,200,140,0.28)";
      g.fillRect(px + 1, py + 1, panel - 2, 1);
      g.fillRect(px + 1, py + 1, 1, panel - 2);
      for (const [rx, ry] of [[3, 3], [panel - 5, 3], [3, panel - 5], [panel - 5, panel - 5]]) {
        g.fillStyle = "#3a2a18";
        g.fillRect(px + rx, py + ry, 3, 3);
        g.fillStyle = "#c4a86a";
        g.fillRect(px + rx + 1, py + ry + 1, 1, 1);
      }
    }
  }
  g.fillStyle = "rgba(60,40,20,0.35)";
  g.fillRect(0, 31, TEX, 2);
  g.fillRect(31, 0, 2, TEX);
  return c;
}

/** Brown brick (inner core). */
export function makeStone(): HTMLCanvasElement {
  const c = paintTex((x, y) => {
    const n = hash(x, y, 7) * 22;
    const row = Math.floor(y / 8);
    const off = (row & 1) ? 8 : 0;
    const brick = Math.floor((x + off) / 16);
    const edge = ((x + off) % 16 < 1) || (y % 8 < 1);
    if (edge) return [58, 28, 18];
    return [110 + n + brick, 52 + n * 0.4, 32 + n * 0.2];
  });
  return c;
}

export function makeFloor(): HTMLCanvasElement {
  return paintTex((x, y) => {
    const n = hash(x, y, 11) * 28;
    const stain = hash(x >> 2, y >> 2, 19) > 0.88 ? 18 : 0;
    const grout = (x % 16 === 0 || y % 16 === 0) ? 12 : 0;
    return [58 + n - stain - grout, 48 + n * 0.7 - stain, 40 + n * 0.4];
  });
}

export function makeCeil(): HTMLCanvasElement {
  return paintTex((x, y) => {
    const n = hash(x, y, 23) * 16;
    const pipe = (y >= 18 && y <= 25) || (y >= 40 && y <= 45);
    if (pipe) return [22 + n, 18 + n, 18 + n];
    return [28 + n, 22 + n, 24 + n * 1.2];
  });
}

export function pixCanvas(rows: string[], pal: Record<string, [number, number, number] | null>): HTMLCanvasElement {
  const w = rows[0]!.length, h = rows.length;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = ctx2d(c);
  if (!g) return c;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    if (row.length !== w) throw new Error(`sprite row ${y} width ${row.length} != ${w}`);
    for (let x = 0; x < w; x++) {
      const p = pal[row[x]!] ?? null;
      if (!p) continue;
      const i = (y * w + x) * 4;
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const FLESH: Record<string, [number, number, number] | null> = {
  ".": null,
  k: [18, 10, 8],
  d: [86, 42, 24],
  m: [140, 72, 42],
  p: [188, 96, 58],
  h: [214, 150, 110],
  e: [255, 220, 70],
  r: [168, 28, 22],
  w: [236, 232, 220],
};

const IMP_ROWS = [
  "......kkkk......",
  ".....kddddk.....",
  "....kdmppmdk....",
  "...kdmppppmdk...",
  "...kmpheephmk...",
  "...kmpheephmk...",
  "....kmppppmdk...",
  "....kdmmmmmdk...",
  ".....kddddk.....",
  "....kdmmmdk.....",
  "...kdm..mdk.....",
  "...kd....dk.....",
  "..kdm....mdk....",
  "..kd......dk....",
  ".kdm......mdk...",
  ".kd........dk...",
  "kd..........dk..",
  "kd..........dk..",
  ".k..kkkkkk..k...",
  "..kk......kk....",
];

const BARON_ROWS = [
  "......kkkkkk......",
  ".....krrrrrrk.....",
  "....krmpppprmk....",
  "...krmpheehpmrk...",
  "...krmpheehpmrk...",
  "....krmppppmrk....",
  "....krrrmmmmrrk...",
  ".....krrrrrrk.....",
  "....krmmmmrk......",
  "...krm....mrk.....",
  "..krm......mrk....",
  "..kr........rk....",
  ".krm........mrk...",
  ".kr..........rk...",
  "kr............rk..",
  "kr....rrrr....rk..",
  ".k..kk....kk..k...",
  "..kk........kk....",
];

const BARON_PAL: Record<string, [number, number, number] | null> = {
  ...FLESH,
  r: [140, 24, 28],
  m: [160, 48, 40],
  p: [196, 70, 52],
};

const ROCKET_ROWS = [
  "....ww....",
  "...wyyw...",
  "..wyyyyw..",
  ".wyyyyyyw.",
  "wyyyyyyyyw",
  "wrryyyyrrw",
  ".rr.yy.rr.",
  "..r....r..",
];

const ROCKET_PAL: Record<string, [number, number, number] | null> = {
  ".": null,
  w: [250, 240, 210],
  y: [255, 186, 60],
  r: [200, 40, 20],
};

const BOOM_ROWS = [
  "......ww......",
  "....wyyyyw....",
  "...wyyyyyyw...",
  "..wyyrrryyw...",
  ".wyyrrrrryyw..",
  ".wyrrwwwrrryw.",
  "wyyrrwwwrrryyw",
  ".wyrrwwwrrryw.",
  ".wyyrrrrryyw..",
  "..wyyrrryyw...",
  "...wyyyyyyw...",
  "....wyyyyw....",
];

const BOOM_PAL: Record<string, [number, number, number] | null> = {
  ".": null,
  w: [255, 250, 220],
  y: [255, 160, 40],
  r: [210, 50, 18],
};

const BLOOD_PAL: Record<string, [number, number, number] | null> = {
  ".": null,
  k: [48, 8, 8],
  r: [140, 16, 16],
  p: [176, 36, 28],
  h: [210, 70, 50],
  w: [220, 200, 170],
};

const GIB0 = [
  "..krrk..",
  ".krrppk.",
  "krpphprk",
  "krphhprk",
  ".kppprk.",
  "..krrk..",
];
const GIB1 = [
  "..wwk...",
  ".kwrrk..",
  "kwrpppk.",
  ".kppprk.",
  "..krrk..",
];
const GIB2 = [
  "...kk...",
  "..kwwk..",
  ".krpprk.",
  "krphhprk",
  ".krrrrk.",
  "..k..k..",
];
const BLOOD = [
  "..krrrrk..",
  ".krrppprk.",
  "krrppppprk",
  ".krrppprk.",
  "..krrrrk..",
];

export function makeLauncher(): HTMLCanvasElement {
  const w = 72, h = 28;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = ctx2d(c);
  if (!g) return c;
  g.fillStyle = "#14180c";
  g.fillRect(2, 5, 58, 14);
  g.fillStyle = "#6a8430";
  g.fillRect(3, 6, 56, 12);
  g.fillStyle = "#8aab40";
  g.fillRect(3, 6, 56, 2);
  g.fillStyle = "#3d4c18";
  g.fillRect(3, 16, 56, 2);
  g.fillStyle = "#1a1208";
  g.fillRect(10, 9, 42, 5);
  g.fillStyle = "#c8d878";
  g.fillRect(3, 6, 5, 12);
  g.fillStyle = "#2a3410";
  g.fillRect(3, 7, 2, 10);
  g.fillStyle = "#3a4c18";
  g.fillRect(48, 16, 10, 11);
  g.fillRect(50, 24, 6, 4);
  g.fillStyle = "#98b048";
  g.fillRect(49, 16, 8, 2);
  return c;
}

let cached: DoomArt | null = null;

export function doomArt(): DoomArt {
  if (cached) return cached;
  const startan = makeStartan();
  const stone = makeStone();
  const floor = makeFloor();
  const ceil = makeCeil();
  cached = {
    startan, stone, floor, ceil,
    floorPix: pix(floor),
    ceilPix: pix(ceil),
    imp: pixCanvas(IMP_ROWS, FLESH),
    baron: pixCanvas(BARON_ROWS, BARON_PAL),
    rocket: pixCanvas(ROCKET_ROWS, ROCKET_PAL),
    boom: pixCanvas(BOOM_ROWS, BOOM_PAL),
    launcher: makeLauncher(),
    gibs: [pixCanvas(GIB0, BLOOD_PAL), pixCanvas(GIB1, BLOOD_PAL), pixCanvas(GIB2, BLOOD_PAL)],
    blood: pixCanvas(BLOOD, BLOOD_PAL),
  };
  return cached;
}

/** Fog a packed little-endian RGBA toward black. */
export function fogRgba(c: number, inv: number): number {
  const r = (c & 255) * inv;
  const g = ((c >> 8) & 255) * inv;
  const b = ((c >> 16) & 255) * inv;
  return (0xff << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

/** Perspective floor + ceiling into `img` (CSS pixels). */
export function paintFlats(
  img: ImageData,
  px: number, py: number,
  dirX: number, dirY: number, planeX: number, planeY: number,
  floorPix: Uint32Array, ceilPix: Uint32Array,
): void {
  const W = img.width, H = img.height;
  const mid = H / 2;
  const out = new Uint32Array(img.data.buffer);
  const mask = TEX - 1;
  const posZ = mid;
  for (let y = 0; y < H; y++) {
    const isFloor = y >= mid;
    const denom = isFloor ? (y - mid) : (mid - y);
    if (denom < 0.6) continue;
    const rowDist = posZ / denom;
    const src = isFloor ? floorPix : ceilPix;
    let fx = px + rowDist * (dirX - planeX);
    let fy = py + rowDist * (dirY - planeY);
    const sx = rowDist * (2 * planeX) / W;
    const sy = rowDist * (2 * planeY) / W;
    const inv = Math.max(0.18, 1 - Math.min(0.82, rowDist / 11));
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const tx = (Math.floor(fx * TEX) & mask);
      const ty = (Math.floor(fy * TEX) & mask);
      out[row + x] = fogRgba(src[ty * TEX + tx]!, inv);
      fx += sx; fy += sy;
    }
  }
}

export function drawTexColumn(
  g: CanvasRenderingContext2D,
  tex: HTMLCanvasElement,
  texX: number, x: number, y: number, w: number, h: number,
  shade: number, fog: number,
): void {
  const tx = Math.max(0, Math.min(TEX - 1, texX | 0));
  g.imageSmoothingEnabled = false;
  g.drawImage(tex, tx, 0, 1, TEX, x, y, w, h);
  if (shade < 0.99) {
    g.fillStyle = `rgba(0,0,0,${1 - shade})`;
    g.fillRect(x, y, w, h);
  }
  if (fog > 0.02) {
    g.fillStyle = `rgba(0,0,0,${fog})`;
    g.fillRect(x, y, w, h);
  }
}

/** Draw a sprite, skipping columns behind the wall z-buffer. */
export function drawSpriteClipped(
  g: CanvasRenderingContext2D,
  art: HTMLCanvasElement,
  cx: number, cy: number, size: number,
  zbuf: Float64Array, ty: number,
): { left: number; right: number } {
  const h = size;
  const w = size * (art.width / Math.max(1, art.height));
  const left = Math.floor(cx - w / 2);
  const top = Math.floor(cy - h / 2);
  const right = Math.ceil(left + w);
  g.imageSmoothingEnabled = false;
  for (let x = Math.max(0, left); x < Math.min(zbuf.length, right); x++) {
    if (ty >= (zbuf[x] || 99)) continue;
    const u = (x - left + 0.5) / w;
    const sx = Math.min(art.width - 1, Math.max(0, Math.floor(u * art.width)));
    g.drawImage(art, sx, 0, 1, art.height, x, top, 1, h);
  }
  return { left, right };
}
