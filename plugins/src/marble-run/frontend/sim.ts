/**
 * Deterministic marble-run simulation — fixed timestep with accumulator cap.
 * Track layout is a function of seed + complexity (shared with sky/fragment.glsl).
 */

import type { MarbleOptions } from "./config";
import { hash01 } from "./config";
import { marbleWorkBudget } from "./work-budget";

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_CATCHUP_STEPS = 4;

export interface MarbleBody {
  active: boolean;
  u: number;
  v: number;
  radius: number;
  hue: number;
  jar: number;
  failed: boolean;
  flying: number;
  flyVx: number;
  flyVy: number;
  flyVz: number;
  id: number;
}

export interface JarState {
  fill: number;
  drain: number;
}

export interface SimWork {
  drawCalls: number;
  triangles: number;
  instances: number;
  gpuBytes: number;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function trackPieceCount(complexity: number, seed: number): number {
  const rnd = mulberry32(seed);
  return 6 + complexity * 3 + Math.floor(rnd() * 3);
}

export function trackBreakpoints(complexity: number, seed: number): number[] {
  const n = trackPieceCount(complexity, seed);
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const pts: number[] = [0];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += 0.55 + rnd() * 0.9;
    pts.push(acc);
  }
  const last = pts[pts.length - 1]!;
  return pts.map((p) => p / last);
}

export function pieceKindAt(u: number, complexity: number, seed: number): number {
  const b = trackBreakpoints(complexity, seed);
  for (let i = 1; i < b.length; i++) {
    if (u <= b[i]!) return i % 7;
  }
  return 0;
}

/** Stable jar slot for a route key (proto or proto hash) — never list position. */
export function jarIndexForRouteKey(routeKey: string, jarCount: number): number {
  if (!routeKey || jarCount <= 0) return 0;
  return Math.min(jarCount - 1, Math.floor(hash01(routeKey) * jarCount * 0.999));
}

export class MarbleSim {
  private readonly pool: MarbleBody[];
  private readonly freeStack: number[];
  private jars: JarState[];
  private acc = 0;
  private simT = 0;
  private nextId = 1;
  private opts: MarbleOptions;
  private seedKey = "";
  private lastIntegrateSteps = 0;
  readonly work: SimWork = { drawCalls: 0, triangles: 0, instances: 0, gpuBytes: 0 };

  constructor(opts: MarbleOptions) {
    this.opts = opts;
    this.pool = Array.from({ length: opts.maxMarbles }, () => MarbleSim.emptyBody());
    this.freeStack = [];
    this.resetFreeStack();
    this.jars = Array.from({ length: opts.jarCount }, () => ({ fill: 0.12, drain: 0 }));
    this.rebuildJars();
  }

  private static emptyBody(): MarbleBody {
    return {
      active: false, u: 0, v: 0, radius: 0.04, hue: 0.3, jar: 0, failed: false,
      flying: 0, flyVx: 0, flyVy: 0, flyVz: 0, id: 0,
    };
  }

  private resetFreeStack(): void {
    this.freeStack.length = 0;
    for (let i = this.pool.length - 1; i >= 0; i--) this.freeStack.push(i);
  }

  private releaseIndex(i: number): void {
    if (!this.pool[i]!.active) this.freeStack.push(i);
  }

  private deactivateAt(i: number): void {
    const m = this.pool[i]!;
    if (!m.active) return;
    m.active = false;
    this.releaseIndex(i);
  }

  setOptions(opts: MarbleOptions): void {
    this.opts = opts;
    const key = `${opts.seed}:${opts.complexity}:${opts.jarCount}:${opts.maxMarbles}`;
    if (key !== this.seedKey) {
      this.seedKey = key;
      this.rebuildJars();
      for (const m of this.pool) m.active = false;
      this.resetFreeStack();
    }
    while (this.jars.length < opts.jarCount) this.jars.push({ fill: 0.1, drain: 0 });
    this.jars.length = opts.jarCount;
  }

  private rebuildJars(): void {
    const rnd = mulberry32(this.opts.seed);
    this.jars = Array.from({ length: this.opts.jarCount }, () => ({
      fill: 0.08 + rnd() * 0.12,
      drain: 0.02 + rnd() * 0.03,
    }));
  }

  spawn(hue: number, radius: number, routeKey: string, failed: boolean): boolean {
    if (!this.freeStack.length) return false;
    const idx = this.freeStack.pop()!;
    const slot = this.pool[idx]!;
    slot.active = true;
    slot.u = 0;
    slot.v = 0;
    slot.radius = radius;
    slot.hue = hue;
    slot.jar = jarIndexForRouteKey(routeKey, this.opts.jarCount);
    slot.failed = failed;
    slot.flying = failed ? 1 : 0;
    slot.flyVx = (hash01(`${this.nextId}:x`) - 0.5) * 1.2;
    slot.flyVy = 0.4 + hash01(`${this.nextId}:y`) * 0.6;
    slot.flyVz = (hash01(`${this.nextId}:z`) - 0.5) * 1.4;
    slot.id = this.nextId++;
    return true;
  }

  stepFrame(dt: number): void {
    this.acc += Math.min(0.1, Math.max(0, dt));
    let steps = 0;
    const budget = marbleWorkBudget();
    while (this.acc >= SIM_DT && steps < Math.min(MAX_CATCHUP_STEPS, budget.maxSimStepsPerFrame)) {
      this.integrate(SIM_DT);
      this.acc -= SIM_DT;
      steps++;
    }
    if (this.acc > SIM_DT * 2) this.acc = SIM_DT;
    this.lastIntegrateSteps = steps;
    this.estimateWork();
  }

  integrateStepsLastFrame(): number {
    return this.lastIntegrateSteps;
  }

  private integrate(dt: number): void {
    this.simT += dt;
    const g = 2.4;
    const friction = 0.18;
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i]!;
      if (!m.active) continue;
      if (m.flying > 0) {
        m.flyVy -= g * dt;
        m.flying += dt;
        if (m.flying > 1.2) this.deactivateAt(i);
        continue;
      }
      const kind = pieceKindAt(m.u, this.opts.complexity, this.opts.seed);
      let accel = g * (0.35 + 0.1 * kind);
      if (kind === 2) accel *= 1.35;
      if (kind === 4) accel *= 0.65;
      m.v += accel * dt;
      m.v *= 1 - friction * dt;
      m.u += m.v * dt * 0.22;
      if (m.u >= 0.995 && !m.failed) {
        const jar = this.jars[m.jar];
        if (jar) jar.fill = Math.min(1, jar.fill + m.radius * 2.5);
        this.deactivateAt(i);
      } else if (m.u >= 1.05) {
        this.deactivateAt(i);
      }
    }
    for (const j of this.jars) {
      j.fill = Math.max(0.04, j.fill - j.drain * dt * 0.15);
    }
  }

  private estimateWork(): void {
    let active = 0;
    for (const m of this.pool) if (m.active) active++;
    const pieces = trackPieceCount(this.opts.complexity, this.opts.seed);
    this.work.instances = active;
    this.work.drawCalls = 12 + pieces + active;
    this.work.triangles = 8000 + pieces * 1200 + active * 96;
    this.work.gpuBytes = 512 * 1024 + active * 4096;
  }

  time(): number {
    return this.simT;
  }

  bodies(): readonly MarbleBody[] {
    return this.pool;
  }

  jarFills(): readonly JarState[] {
    return this.jars;
  }

  leadMarble(): MarbleBody | null {
    let best: MarbleBody | null = null;
    for (const m of this.pool) {
      if (!m.active || m.flying > 0) continue;
      if (!best || m.u > best.u) best = m;
    }
    return best;
  }

  dispose(): void {
    for (const m of this.pool) m.active = false;
    this.resetFreeStack();
    this.acc = 0;
    this.simT = 0;
  }
}
