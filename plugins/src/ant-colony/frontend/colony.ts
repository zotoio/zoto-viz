import type { AntColonyLook } from "./config";
import { ANT_WORK_BUDGET } from "./config";

export const PG_W = 32;
export const PG_H = 8;
export const PG_CELLS = PG_W * PG_H;
export const MAX_CHAMBERS = 12;
export const MAX_TUNNELS = 16;
export const MAX_ANT_INSTANCES = ANT_WORK_BUDGET.instances;
export const META_FLOATS = 24;
export const CHAMBER_FLOATS = MAX_CHAMBERS * 4;
export const TUNNEL_FLOATS = MAX_TUNNELS * 4;
export const ANT_PACK_FLOATS = 48;

export const SLOT_META = 0;
export const SLOT_CHAMBERS = 1;
export const SLOT_TUNNELS = 2;
export const SLOT_PHERO_A = 3;
export const SLOT_PHERO_B = 4;
export const SLOT_PHERO_C = 5;
export const SLOT_PHERO_D = 6;
export const SLOT_ANTS = 7;

export const META = {
  camX: 0,
  camY: 1,
  camZ: 2,
  day: 3,
  rain: 4,
  fail: 5,
  demo: 6,
  metric: 7,
  preset: 8,
  reduced: 9,
  soil: 10,
  palette: 11,
  chamberCount: 12,
  tunnelCount: 13,
  followAnt: 14,
  labelLen: 15,
  labelStart: 16,
} as const;

export type VizSlice = {
  t: number;
  dt: number;
  audio: number;
  demo?: boolean;
  packets: { proto: string; size: number; field: number }[];
  talkers: { id: string; rate: number; role: string }[];
  sys?: { failed: number };
};

interface Chamber {
  id: string;
  x: number;
  y: number;
  r: number;
  heat: number;
  fail: number;
}

interface Tunnel {
  a: number;
  b: number;
  grow: number;
  rate: number;
}

interface Ant {
  tunnel: number;
  u: number;
  speed: number;
  phase: number;
  crumb: number;
  soldier: number;
  alive: number;
}

function hash01(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function presetIndex(p: AntColonyLook["preset"]): number {
  if (p === "formicarium") return 0;
  if (p === "night-glow") return 1;
  if (p === "red-alert") return 2;
  return 3;
}

function paletteIndex(p: AntColonyLook["palette"]): number {
  if (p === "loam") return 0;
  if (p === "clay") return 1;
  if (p === "chalk") return 2;
  return 3;
}

function soilIndex(s: AntColonyLook["soilStyle"]): number {
  if (s === "strata") return 0;
  if (s === "sand") return 1;
  return 2;
}

export class AntColonySim {
  private readonly phero: Float32Array;
  private readonly pheroTmp: Float32Array;
  private readonly chambers: Chamber[] = [];
  private readonly tunnels: Tunnel[] = [];
  private readonly ants: Ant[];
  private acc = 0;
  private simT = 0;
  private followIdx = 0;
  private raf: number | null = null;
  private disposed = false;
  private allocAfterWarm = false;
  private readonly slotMeta = new Array(META_FLOATS).fill(0);
  private readonly slotChambers = new Array(CHAMBER_FLOATS).fill(0);
  private readonly slotTunnels = new Array(TUNNEL_FLOATS).fill(0);
  private readonly slotPhero = [
    new Array(64).fill(0),
    new Array(64).fill(0),
    new Array(64).fill(0),
    new Array(64).fill(0),
  ];
  private readonly slotAnts = new Array(ANT_PACK_FLOATS).fill(0);

  constructor(private look: AntColonyLook) {
    this.phero = new Float32Array(PG_CELLS);
    this.pheroTmp = new Float32Array(PG_CELLS);
    this.ants = Array.from({ length: MAX_ANT_INSTANCES }, () => ({
      tunnel: 0, u: 0, speed: 0.2, phase: 0, crumb: 0.2, soldier: 0, alive: 0,
    }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.raf);
    }
    this.raf = null;
    this.chambers.length = 0;
    this.tunnels.length = 0;
    this.phero.fill(0);
    for (const a of this.ants) a.alive = 0;
  }

  setLook(look: AntColonyLook): void {
    this.look = look;
  }

  /** Light-test hook: no new Array allocations after warm-up frames. */
  markWarm(): void {
    this.allocAfterWarm = true;
  }

  warmAllocCheck(): boolean {
    return this.allocAfterWarm;
  }

  private layoutChambers(talkers: VizSlice["talkers"], seed: number): void {
    this.chambers.length = 0;
    const n = Math.min(MAX_CHAMBERS, Math.max(3, talkers.length || 6));
    for (let i = 0; i < n; i++) {
      const talker = talkers[i];
      const ang = i * 2.399963 + hash01(seed, i) * 0.4;
      const rad = 0.18 + (i / n) * 0.42 + hash01(seed, i + 19) * 0.08;
      const rate = talker?.rate ?? 40 + hash01(seed, i + 3) * 80;
      this.chambers.push({
        id: talker?.id ?? `nest-${i}`,
        x: 0.5 + Math.cos(ang) * rad,
        y: 0.42 + Math.sin(ang) * rad * 0.72,
        r: 0.045 + Math.min(0.05, rate / 4000),
        heat: Math.min(1, rate / 220),
        fail: 0,
      });
    }
    // Queen chamber at center
    this.chambers[0]!.r = Math.max(this.chambers[0]!.r, 0.075);
    this.chambers[0]!.heat = Math.max(this.chambers[0]!.heat, 0.35);
  }

  private layoutTunnels(packets: VizSlice["packets"], seed: number): void {
    this.tunnels.length = 0;
    const c = this.chambers.length;
    if (c < 2) return;
    const want = Math.min(MAX_TUNNELS, Math.max(4, packets.length || 6));
    for (let i = 0; i < want; i++) {
      const pkt = packets[i];
      const a = Math.floor(hash01(seed, i * 2) * c) % c;
      let b = Math.floor(hash01(seed, i * 2 + 1) * c) % c;
      if (a === b) b = (b + 1) % c;
      const rate = pkt ? pkt.field : 0.25 + hash01(seed, i + 40) * 0.5;
      const grow = this.look.mapFlows ? Math.min(1, 0.35 + rate * 0.8) : 0.6;
      this.tunnels.push({ a, b, grow, rate });
    }
  }

  private spawnAnts(frame: VizSlice): void {
    const cap = Math.min(this.look.antCap, MAX_ANT_INSTANCES);
    let alive = 0;
    for (let i = 0; i < cap; i++) {
      const ant = this.ants[i]!;
      const tunnel = i % Math.max(1, this.tunnels.length);
      const t = this.tunnels[tunnel];
      if (!t) {
        ant.alive = 0;
        continue;
      }
      ant.tunnel = tunnel;
      ant.u = hash01(this.look.seed, i + 90);
      const spd = this.look.mapRate ? 0.12 + t.rate * 0.55 : 0.25;
      ant.speed = spd * (this.look.rain ? 0.55 : 1);
      ant.phase = hash01(this.look.seed, i + 120) * 6.28;
      const pkt = frame.packets[i % Math.max(1, frame.packets.length)];
      ant.crumb = this.look.mapBytes && pkt ? 0.15 + pkt.field * 0.65 : 0.25;
      ant.soldier = 0;
      ant.alive = 1;
      alive++;
    }
    const fail = frame.sys?.failed ?? 0;
    if (this.look.mapFailures && fail > 0.02) {
      const soldiers = Math.min(24, Math.ceil(fail * 28));
      for (let s = 0; s < soldiers && s < cap; s++) {
        const ant = this.ants[s]!;
        ant.tunnel = 0;
        ant.u = hash01(this.look.seed, s + 200);
        ant.speed = 0.08;
        ant.soldier = 1;
        ant.crumb = 0.1;
        ant.alive = 1;
        this.chambers[0]!.fail = Math.min(1, fail);
      }
    }
    if (alive === 0) {
      for (let i = 0; i < Math.min(12, cap); i++) {
        const ant = this.ants[i]!;
        ant.alive = 1;
        ant.tunnel = i % Math.max(1, this.tunnels.length);
      }
    }
  }

  private stepPheromone(dt: number): void {
    const evap = this.look.evaporation;
    const diff = this.look.diffusion;
    const src = this.phero;
    const tmp = this.pheroTmp;
    for (let y = 0; y < PG_H; y++) {
      for (let x = 0; x < PG_W; x++) {
        const i = y * PG_W + x;
        let sum = src[i]! * (1 - diff);
        let w = 1 - diff;
        if (x > 0) { sum += src[i - 1]! * diff * 0.25; w += diff * 0.25; }
        if (x < PG_W - 1) { sum += src[i + 1]! * diff * 0.25; w += diff * 0.25; }
        if (y > 0) { sum += src[i - PG_W]! * diff * 0.25; w += diff * 0.25; }
        if (y < PG_H - 1) { sum += src[i + PG_W]! * diff * 0.25; w += diff * 0.25; }
        tmp[i] = (sum / w) * Math.pow(evap, dt * 60);
      }
    }
    this.phero.set(tmp);
  }

  private depositPheromone(): void {
    for (const ant of this.ants) {
      if (!ant.alive || ant.soldier > 0.5) continue;
      const tunnel = this.tunnels[ant.tunnel];
      if (!tunnel) continue;
      const ca = this.chambers[tunnel.a];
      const cb = this.chambers[tunnel.b];
      if (!ca || !cb) continue;
      const px = ca.x + (cb.x - ca.x) * ant.u;
      const py = ca.y + (cb.y - ca.y) * ant.u;
      const gx = Math.min(PG_W - 1, Math.max(0, Math.floor(px * PG_W)));
      const gy = Math.min(PG_H - 1, Math.max(0, Math.floor(py * PG_H)));
      const idx = gy * PG_W + gx;
      this.phero[idx] = Math.min(1, this.phero[idx]! + 0.08 + tunnel.rate * 0.12);
    }
  }

  private integrateAnts(dt: number): void {
    for (const ant of this.ants) {
      if (!ant.alive) continue;
      if (ant.soldier > 0.5) {
        ant.phase += dt * 4;
        ant.u = 0.5 + Math.sin(ant.phase) * 0.12;
        continue;
      }
      ant.u += ant.speed * dt;
      if (ant.u > 1) ant.u -= 1;
      ant.phase += dt * (6 + ant.speed * 12);
    }
    this.followIdx = (this.followIdx + 1) % Math.max(1, this.look.antCap);
  }

  private growTunnels(dt: number): void {
    for (const tunnel of this.tunnels) {
      if (this.look.mapFlows) tunnel.grow = Math.min(1, tunnel.grow + dt * 0.08 * (0.3 + tunnel.rate));
      else tunnel.grow = Math.min(1, tunnel.grow + dt * 0.03);
    }
  }

  tick(frame: VizSlice): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, frame.dt || 1 / 60));
    this.acc += dt;
    const step = 1 / 60;
    let guard = 0;
    while (this.acc >= step && guard < 3) {
      this.acc -= step;
      guard++;
      this.stepPheromone(step);
      this.depositPheromone();
      this.integrateAnts(step);
      this.growTunnels(step);
      this.simT += step;
    }
    const bucket = Math.min(MAX_CHAMBERS, Math.max(3, frame.talkers.length || 6));
    if (bucket !== this.chambers.length) {
      this.layoutChambers(frame.talkers, this.look.seed);
      this.layoutTunnels(frame.packets, this.look.seed);
    }
    this.spawnAnts(frame);
  }

  packLabelText(frame: VizSlice): string {
    const metric = frame.demo ? "demo" : `${Math.round((frame.talkers[0]?.rate ?? 0))} pkt/s`;
    const preset = this.look.preset.replace("-", " ");
    const extra = this.look.label ? ` · ${this.look.label}` : "";
    return `ant colony · ${preset} · ${metric}${extra}`;
  }

  packSlots(frame: VizSlice): number[][] {
    const meta = this.slotMeta;
    meta.fill(0);
    const camMode = this.look.reducedMotion ? "cutaway" : this.look.camera;
    let camX = 0.5;
    let camY = 0.45;
    if (camMode === "pan") {
      camX = 0.5 + Math.sin(frame.t * 0.08) * 0.12;
      camY = 0.45 + Math.cos(frame.t * 0.06) * 0.06;
    } else if (camMode === "follow") {
      const ant = this.ants[this.followIdx % this.ants.length];
      const tunnel = ant?.alive ? this.tunnels[ant.tunnel] : undefined;
      if (tunnel) {
        const ca = this.chambers[tunnel.a];
        const cb = this.chambers[tunnel.b];
        if (ca && cb) {
          camX = ca.x + (cb.x - ca.x) * ant.u;
          camY = ca.y + (cb.y - ca.y) * ant.u;
        }
      }
    }
    const day = 0.5 + 0.5 * Math.sin(frame.t * 0.05 + this.look.seed * 0.001);
    meta[META.camX] = camX;
    meta[META.camY] = camY;
    meta[META.camZ] = camMode === "cutaway" ? 1.1 : 1.35;
    meta[META.day] = day;
    meta[META.rain] = this.look.rain ? 1 : 0;
    meta[META.fail] = frame.sys?.failed ?? this.chambers[0]?.fail ?? 0;
    meta[META.demo] = frame.demo ? 1 : 0;
    meta[META.metric] = Math.min(1, (frame.talkers[0]?.rate ?? 0) / 240);
    meta[META.preset] = presetIndex(this.look.preset);
    meta[META.reduced] = this.look.reducedMotion ? 1 : 0;
    meta[META.soil] = soilIndex(this.look.soilStyle);
    meta[META.palette] = paletteIndex(this.look.palette);
    meta[META.chamberCount] = this.chambers.length;
    meta[META.tunnelCount] = this.tunnels.length;
    meta[META.followAnt] = this.followIdx / MAX_ANT_INSTANCES;

    const label = this.packLabelText(frame).slice(0, 12);
    meta[META.labelLen] = label.length;
    for (let i = 0; i < label.length && i < 8; i++) {
      meta[META.labelStart + i] = (label.charCodeAt(i) - 32) / 95;
    }

    const chambers = this.slotChambers;
    chambers.fill(0);
    for (let i = 0; i < this.chambers.length; i++) {
      const c = this.chambers[i]!;
      const o = i * 4;
      chambers[o] = c.x;
      chambers[o + 1] = c.y;
      chambers[o + 2] = c.r;
      chambers[o + 3] = c.heat + c.fail * 2;
    }

    const tunnels = this.slotTunnels;
    tunnels.fill(0);
    for (let i = 0; i < this.tunnels.length; i++) {
      const t = this.tunnels[i]!;
      const ca = this.chambers[t.a];
      const cb = this.chambers[t.b];
      if (!ca || !cb) continue;
      const o = i * 4;
      tunnels[o] = ca.x;
      tunnels[o + 1] = ca.y;
      tunnels[o + 2] = cb.x;
      tunnels[o + 3] = cb.y + t.grow * 0.001;
    }

    const pheroSlots = this.slotPhero;
    for (const row of pheroSlots) row.fill(0);
    for (let i = 0; i < PG_CELLS; i++) {
      const slot = Math.floor(i / 64);
      const off = i % 64;
      pheroSlots[slot][off] = this.phero[i]!;
    }

    const ants = this.slotAnts;
    ants.fill(0);
    let k = 0;
    for (const ant of this.ants) {
      if (!ant.alive || k >= ANT_PACK_FLOATS - 5) break;
      const tunnel = this.tunnels[ant.tunnel];
      let x = 0.5;
      let y = 0.5;
      let heading = 0;
      if (tunnel) {
        const ca = this.chambers[tunnel.a];
        const cb = this.chambers[tunnel.b];
        if (ca && cb) {
          x = ca.x + (cb.x - ca.x) * ant.u;
          y = ca.y + (cb.y - ca.y) * ant.u;
          heading = Math.atan2(cb.y - ca.y, cb.x - ca.x) / Math.PI;
        }
      }
      ants[k++] = x;
      ants[k++] = y;
      ants[k++] = heading;
      ants[k++] = (ant.phase % 6.28) / 6.28;
      ants[k++] = ant.crumb;
      ants[k++] = ant.soldier;
    }

    return [meta, chambers, tunnels, ...pheroSlots, ants];
  }

  workCounts(): { instances: number; drawCalls: number } {
    let instances = 0;
    for (const a of this.ants) if (a.alive) instances++;
    return { instances, drawCalls: ANT_WORK_BUDGET.drawCalls };
  }
}

export function createColony(look: AntColonyLook): AntColonySim {
  return new AntColonySim(look);
}
