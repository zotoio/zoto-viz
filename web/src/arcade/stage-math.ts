/** Pure layout helpers for the 3D arcade views. No Three.js — unit-tested. */

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hashUnit(s: string, salt = 0): number {
  return ((hash32(s) + salt * 0x9e3779b9) >>> 0) / 0xffffffff;
}

/** Sum of two Gerstner trains. Returns [dx, height, dz]. */
export function gerstner(x: number, z: number, t: number, amp: number): [number, number, number] {
  const a = Math.max(0, amp);
  const k1 = 0.22, w1 = 1.15, q1 = 0.35;
  const k2 = 0.37, w2 = 1.7, q2 = 0.22;
  const p1 = k1 * (x * 0.92 + z * 0.38) - w1 * t;
  const p2 = k2 * (x * -0.4 + z * 0.91) - w2 * t;
  const s1 = Math.sin(p1), c1 = Math.cos(p1);
  const s2 = Math.sin(p2), c2 = Math.cos(p2);
  return [
    q1 * a * c1 + q2 * a * 0.6 * c2,
    a * s1 + a * 0.55 * s2,
    q1 * a * 0.4 * c1 + q2 * a * c2,
  ];
}

export function helixPoint(i: number, n: number, strand: 0 | 1, turns = 3): [number, number, number] {
  const t = n <= 1 ? 0 : i / (n - 1);
  const ang = t * turns * Math.PI * 2 + strand * Math.PI;
  const r = 10;
  return [Math.cos(ang) * r, (t - 0.5) * 28, Math.sin(ang) * r];
}

/** Archimedean carousel: cards climb while they orbit. `spin` is radians. */
export function carouselPoint(i: number, n: number, spin: number, turns = 2.15): [number, number, number] {
  const count = Math.max(1, n);
  const t = i / count;
  const ang = t * turns * Math.PI * 2 + spin;
  const r = 8.2 + t * 3.6;
  return [Math.cos(ang) * r, (t - 0.5) * 14, Math.sin(ang) * r];
}

/** Yaw that puts card `i` on +X (in front of the default camera). */
export function carouselSpinFor(i: number, n: number, turns = 2.15): number {
  const count = Math.max(1, n);
  return -(i / count) * turns * Math.PI * 2;
}

/** One still: zoom in, hold the caption, zoom out into the next card. */
export const CAROUSEL_PERIOD = 11;

export type CarouselBeat = {
  phase: "in" | "hold" | "out";
  /** 0 = wide spiral, 1 = tight on the featured still. */
  zoom: number;
  /** 0 = caption hidden, 1 = title fully up. */
  caption: number;
  /** 0 = current card, 1 = next card (spin during `out`). */
  travel: number;
};

export function carouselBeat(elapsed: number, period = CAROUSEL_PERIOD): CarouselBeat {
  const span = period > 0 ? period : CAROUSEL_PERIOD;
  const p = ((elapsed % span) + span) % span;
  const inEnd = span * 0.16;
  const holdEnd = span * 0.74;
  const smooth = (t: number) => {
    const u = clamp(t, 0, 1);
    return u * u * (3 - 2 * u);
  };
  if (p < inEnd) {
    const e = smooth(p / inEnd);
    return { phase: "in", zoom: e, caption: e, travel: 0 };
  }
  if (p < holdEnd) {
    return { phase: "hold", zoom: 1, caption: 1, travel: 0 };
  }
  const e = smooth((p - holdEnd) / (span - holdEnd));
  return { phase: "out", zoom: 1 - e, caption: 1 - e, travel: e };
}

/**
 * World scale for a w×h plane at `distance` so it covers a perspective frustum.
 * Closer camera → smaller scale (perspective already enlarges the card).
 */
export function planeCoverScale(
  distance: number,
  fovDeg: number,
  aspect: number,
  planeW: number,
  planeH: number,
): number {
  const d = Math.max(0.2, distance);
  const fov = (Math.max(1, fovDeg) * Math.PI) / 180;
  const visibleH = 2 * Math.tan(fov / 2) * d;
  const visibleW = visibleH * Math.max(0.2, aspect);
  const sx = visibleW / Math.max(0.01, planeW);
  const sy = visibleH / Math.max(0.01, planeH);
  return Math.max(sx, sy);
}

/** Fit a photo into a landscape matte without stretching (NASA IOTD and HN stills). */
export function fitStillSize(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  const box = maxW / Math.max(0.01, maxH);
  const a = Number.isFinite(aspect) && aspect > 0.05 ? aspect : box;
  if (a >= box) return { w: maxW, h: maxW / a };
  return { w: maxH * a, h: maxH };
}

/** Featured still: rest size at zoom 0, frustum-cover at zoom 1. */
export function carouselStillScale(zoom: number, cover: number, wide = 0.86): number {
  return wide + (cover - wide) * clamp(zoom, 0, 1);
}

export function orbitRadius(role: string, index: number, count: number): number {
  const base = role === "gateway" ? 0 : role === "self" ? 8 : role === "lan" || role === "local" ? 16 : role === "multicast" ? 22 : 30;
  const spread = count <= 1 ? 0 : (index / count) * 4;
  return base + spread;
}

export function orbitPhase(id: string, index: number): number {
  return hashUnit(id) * Math.PI * 2 + index * 0.17;
}

export function skylineHeight(rate: number, packets: number): number {
  const r = Math.log10(1 + rate) / 4.5;
  const p = Math.log10(1 + packets) / 6;
  return clamp(1.2 + 14 * Math.max(r, p * 0.65), 1.2, 18);
}

export const TETROMINOES: Record<string, [number, number][]> = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

export const TETRO_KEYS = Object.keys(TETROMINOES);

export function tetrominoForProto(proto: string): string {
  const keys = TETRO_KEYS;
  return keys[hash32(proto.toLowerCase()) % keys.length]!;
}

export function rotateCells(cells: [number, number][], turns: number): [number, number][] {
  const t = ((turns % 4) + 4) % 4;
  return cells.map(([x, y]) => {
    if (t === 0) return [x, y];
    if (t === 1) return [y, -x];
    if (t === 2) return [-x, -y];
    return [-y, x];
  });
}

export function normalizeCells(cells: [number, number][]): [number, number][] {
  let minX = Infinity, minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

/** Classic-ish open maze: border walls, plus a lattice of rooms with corridors. */
export function buildPacMaze(cols: number, rows: number): boolean[][] {
  const w = Math.max(9, cols | 1);
  const h = Math.max(9, rows | 1);
  const wall = Array.from({ length: h }, () => Array<boolean>(w).fill(true));
  const carve = (x: number, y: number) => {
    if (y > 0 && y < h - 1 && x > 0 && x < w - 1) wall[y]![x] = false;
  };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (x % 2 === 1 || y % 2 === 1) carve(x, y);
    }
  }
  for (let y = 2; y < h - 2; y += 4) {
    for (let x = 2; x < w - 2; x += 4) {
      wall[y]![x] = true;
      if (x + 1 < w - 1) wall[y]![x + 1] = true;
      if (y + 1 < h - 1) wall[y + 1]![x] = true;
    }
  }
  const midY = (h / 2) | 0;
  const midX = (w / 2) | 0;
  for (let x = 2; x < w - 2; x++) wall[midY]![x] = false;
  for (let y = 2; y < h - 2; y++) wall[y]![midX] = false;
  wall[midY]![1] = false;
  wall[midY]![w - 2] = false;
  return wall;
}

export function mazeOpens(wall: boolean[][]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < wall.length; y++) {
    for (let x = 0; x < wall[y]!.length; x++) {
      if (!wall[y]![x]) out.push([x, y]);
    }
  }
  return out;
}

export function mazeStep(wall: boolean[][], x: number, y: number, dir: 0 | 1 | 2 | 3): [number, number, 0 | 1 | 2 | 3] {
  const dx = [1, 0, -1, 0][dir]!;
  const dy = [0, 1, 0, -1][dir]!;
  const w = wall[0]!.length, h = wall.length;
  const nx = x + dx, ny = y + dy;
  if (ny >= 0 && ny < h && nx >= 0 && nx < w && !wall[ny]![nx]) return [nx, ny, dir];
  if (dir === 0 && nx >= w - 1) return [1, y, dir];
  if (dir === 2 && nx <= 0) return [w - 2, y, dir];
  if (dir === 1 && ny >= h - 1) return [x, 1, dir];
  if (dir === 3 && ny <= 0) return [x, h - 2, dir];
  return [x, y, dir];
}

/** Unit-cube travel: approach portal A, teleport, leave portal B. t in 0..1. */
export function portalTravel(
  from: [number, number, number],
  portalA: [number, number, number],
  portalB: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  const u = clamp(t, 0, 1);
  if (u < 0.45) {
    const p = u / 0.45;
    return lerp3(from, portalA, easeIn(p));
  }
  if (u < 0.55) {
    const p = (u - 0.45) / 0.1;
    return lerp3(portalA, portalB, p);
  }
  const p = (u - 0.55) / 0.45;
  return lerp3(portalB, to, easeOut(p));
}

export function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function easeIn(t: number): number { return t * t; }
function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
