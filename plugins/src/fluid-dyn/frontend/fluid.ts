/**
 * Jos Stam stable fluids on a 10×10 grid (borders included).
 * The picture is uploaded in the 512-float viz UBO: 64 header floats, then dye, hue, vx, vy.
 */

import {
  type FluidCharacter,
  type FluidOptions,
  parseFluidOptions,
} from "./options";

export const FLUID_N = 10;
export const FLUID_CELLS = FLUID_N * FLUID_N;
export const FLUID_HEADER = 64;
export const FLUID_ORIGIN = 64;

export const FLUID_SHADE_ID = { dye: 0, speed: 1, vorticity: 2, stream: 3, mix: 4 } as const;
export const FLUID_PALETTE_ID = { ink: 0, ocean: 1, magma: 2, thermal: 3, neon: 4, mono: 5 } as const;
export const FLUID_OBSTACLE_ID = { none: 0, cylinder: 1, ellipse: 2, pillars: 3, slit: 4 } as const;

export interface FluidDrive {
  audio: number;
  traffic: number;
  kick: boolean;
}

export interface FluidMemory {
  lastCharacter: string;
  lastClear: string;
}

interface Emitter {
  x: number;
  y: number;
  hue: number;
  vx: number;
  vy: number;
}

interface Recipe {
  obstacle: number;
  obsX: number;
  obsY: number;
  obsSize: number;
  gravity: number;
  windX: number;
  windY: number;
  swirl: number;
  stirrer: number;
  shear: number;
  viscosity: number;
  diffusion: number;
  dissipation: number;
  vorticity: number;
  emitters: Emitter[];
}

export interface ResolvedFluid {
  obstacle: number;
  obsX: number;
  obsY: number;
  obsSize: number;
  gravity: number;
  windX: number;
  windY: number;
  swirl: number;
  stirrer: number;
  shear: number;
  viscosity: number;
  diffusion: number;
  dissipation: number;
  vorticity: number;
  emitters: Emitter[];
  emitRate: number;
  emitSize: number;
  iterations: number;
  speed: number;
  paused: boolean;
  shade: number;
  palette: number;
  glow: number;
  foam: number;
  streamSteps: number;
  detail: number;
  gamma: number;
  domain: number;
  vectors: number;
  hue: number;
  audio: FluidOptions["audioMode"];
  trafficStir: boolean;
  reducedMotion: boolean;
}

const RECIPES: Record<FluidCharacter, Recipe> = {
  ink: {
    obstacle: 0, obsX: 0.5, obsY: 0.5, obsSize: 0.12,
    gravity: -0.55, windX: 0.05, windY: 0, swirl: 0.15, stirrer: 0.2, shear: 0,
    viscosity: 0.22, diffusion: 0.08, dissipation: 0.12, vorticity: 0.28,
    emitters: [{ x: 0.5, y: 0.78, hue: 0.72, vx: 0.1, vy: -0.85 }],
  },
  smoke: {
    obstacle: 0, obsX: 0.5, obsY: 0.5, obsSize: 0.1,
    gravity: 0.95, windX: 0.12, windY: 0.1, swirl: 0.35, stirrer: 0.15, shear: 0,
    viscosity: 0.1, diffusion: 0.18, dissipation: 0.28, vorticity: 0.55,
    emitters: [{ x: 0.5, y: 0.16, hue: 0.08, vx: 0, vy: 0.35 }],
  },
  vortex: {
    obstacle: 1, obsX: 0.46, obsY: 0.5, obsSize: 0.11,
    gravity: 0, windX: 1.15, windY: 0, swirl: 0.2, stirrer: 0, shear: 0,
    viscosity: 0.06, diffusion: 0.04, dissipation: 0.16, vorticity: 0.85,
    emitters: [{ x: 0.14, y: 0.5, hue: 0.55, vx: 1.1, vy: 0 }],
  },
  river: {
    obstacle: 4, obsX: 0.68, obsY: 0.5, obsSize: 0.28,
    gravity: -0.08, windX: 1.05, windY: 0, swirl: 0.05, stirrer: 0.1, shear: 0,
    viscosity: 0.08, diffusion: 0.05, dissipation: 0.1, vorticity: 0.4,
    emitters: [
      { x: 0.1, y: 0.66, hue: 0.58, vx: 0.9, vy: 0 },
      { x: 0.1, y: 0.34, hue: 0.12, vx: 0.9, vy: 0 },
    ],
  },
  lava: {
    obstacle: 0, obsX: 0.5, obsY: 0.42, obsSize: 0.14,
    gravity: -0.35, windX: 0, windY: 0, swirl: 0.08, stirrer: 0.05, shear: 0,
    viscosity: 0.92, diffusion: 0.02, dissipation: 0.04, vorticity: 0.12,
    emitters: [{ x: 0.5, y: 0.22, hue: 0.02, vx: 0, vy: 0.15 }],
  },
  storm: {
    obstacle: 3, obsX: 0.5, obsY: 0.48, obsSize: 0.1,
    gravity: 0.15, windX: 0.35, windY: 0.05, swirl: 1.2, stirrer: 0.9, shear: 0,
    viscosity: 0.07, diffusion: 0.1, dissipation: 0.2, vorticity: 0.95,
    emitters: [
      { x: 0.32, y: 0.7, hue: 0.6, vx: 0.2, vy: -0.2 },
      { x: 0.7, y: 0.28, hue: 0.78, vx: -0.2, vy: 0.3 },
    ],
  },
  oil: {
    obstacle: 2, obsX: 0.55, obsY: 0.5, obsSize: 0.16,
    gravity: -0.2, windX: 0.15, windY: 0, swirl: 0.1, stirrer: 0.25, shear: 0,
    viscosity: 0.62, diffusion: 0.03, dissipation: 0.06, vorticity: 0.08,
    emitters: [
      { x: 0.32, y: 0.72, hue: 0.1, vx: 0, vy: -0.25 },
      { x: 0.68, y: 0.72, hue: 0.58, vx: 0, vy: -0.25 },
    ],
  },
  kelvin: {
    obstacle: 0, obsX: 0.5, obsY: 0.5, obsSize: 0.08,
    gravity: 0, windX: 0, windY: 0, swirl: 0.05, stirrer: 0, shear: 1.25,
    viscosity: 0.05, diffusion: 0.02, dissipation: 0.05, vorticity: 0.7,
    emitters: [
      { x: 0.5, y: 0.62, hue: 0.58, vx: 0.8, vy: 0 },
      { x: 0.5, y: 0.38, hue: 0.04, vx: -0.8, vy: 0 },
    ],
  },
};

function around(slider: number, recipe: number): number {
  return recipe * (slider / 0.5);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function resolveFluid(opts: FluidOptions): ResolvedFluid {
  const recipe = RECIPES[opts.character];
  let emitters = recipe.emitters.map((e) => ({ ...e, hue: (e.hue + opts.hue) % 1 }));
  const spread = opts.hueSpread / 0.5;
  emitters = emitters.map((e, i) => ({ ...e, hue: (e.hue + (i - (emitters.length - 1) / 2) * 0.18 * spread + 1) % 1 }));
  if (opts.emitters === "one") emitters = emitters.slice(0, 1);
  else if (opts.emitters === "two") emitters = emitters.slice(0, 2);
  else if (opts.emitters === "three") {
    while (emitters.length < 3) {
      const last = emitters[emitters.length - 1] ?? recipe.emitters[0]!;
      emitters.push({ ...last, y: clamp01(last.y - 0.18), hue: (last.hue + 0.33) % 1 });
    }
  }
  const motion = opts.reducedMotion ? 0.25 : 1;
  return {
    obstacle: recipe.obstacle,
    obsX: recipe.obsX,
    obsY: recipe.obsY,
    obsSize: Math.min(0.42, Math.max(0, around(opts.obstacle, recipe.obsSize))),
    gravity: around(opts.gravity, recipe.gravity),
    windX: around(opts.wind, recipe.windX),
    windY: around(opts.wind, recipe.windY),
    swirl: around(opts.swirl, recipe.swirl) * motion,
    stirrer: around(opts.stirrer, recipe.stirrer) * motion,
    shear: around(opts.wind, recipe.shear),
    viscosity: clamp01(around(opts.viscosity, recipe.viscosity)),
    diffusion: clamp01(around(opts.diffusion, recipe.diffusion)),
    dissipation: clamp01(around(opts.dissipation, recipe.dissipation)),
    vorticity: Math.max(0, around(opts.vorticity, recipe.vorticity)),
    emitters,
    emitRate: Math.max(0, opts.emitRate / 0.5),
    emitSize: Math.max(0.04, (opts.emitSize / 0.5) * 0.16),
    iterations: opts.iterations,
    speed: opts.paused ? 0 : opts.speed * (opts.reducedMotion ? 0.22 : 1),
    paused: opts.paused,
    shade: FLUID_SHADE_ID[opts.shade],
    palette: FLUID_PALETTE_ID[opts.palette],
    glow: opts.glow,
    foam: opts.foam,
    streamSteps: opts.streamSteps,
    detail: opts.detail,
    gamma: opts.gamma,
    domain: opts.domain === "tank" ? 1 : 0,
    vectors: opts.vectors ? 1 : 0,
    hue: opts.hue,
    audio: opts.audioMode,
    trafficStir: opts.trafficStir,
    reducedMotion: opts.reducedMotion,
  };
}

export function fluidDt(dt: number, opts: FluidOptions): number {
  if (opts.paused || opts.speed <= 0) return 0;
  const raw = dt > 0 && dt < 0.25 ? dt : 1 / 60;
  const motion = opts.reducedMotion ? 0.22 : 1;
  return Math.min(0.05, raw * (opts.speed / 0.55) * motion);
}

function ix(i: number, j: number): number {
  return i + j * FLUID_N;
}

/** Domain 0..1. Matches the sky SDF. */
export function fluidSolid(x: number, y: number, obstacle: number, obsX: number, obsY: number, obsSize: number): boolean {
  if (obstacle <= 0 || obsSize <= 0.001) return false;
  if (obstacle === FLUID_OBSTACLE_ID.cylinder) {
    const dx = x - obsX;
    const dy = y - obsY;
    return dx * dx + dy * dy < obsSize * obsSize;
  }
  if (obstacle === FLUID_OBSTACLE_ID.ellipse) {
    const dx = (x - obsX) / Math.max(0.02, obsSize * 1.7);
    const dy = (y - obsY) / Math.max(0.02, obsSize * 0.42);
    return dx * dx + dy * dy < 1;
  }
  if (obstacle === FLUID_OBSTACLE_ID.pillars) {
    const r = Math.max(0.03, obsSize * 0.55);
    for (let k = -1; k <= 1; k++) {
      const dx = x - (obsX + k * 0.2);
      const dy = y - obsY;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }
  const wall = Math.abs(x - obsX) < 0.04;
  const gap = Math.abs(y - obsY) < obsSize * 0.7;
  return wall && !gap;
}

function cellSolid(i: number, j: number, r: ResolvedFluid): boolean {
  return fluidSolid((i + 0.5) / FLUID_N, (j + 0.5) / FLUID_N, r.obstacle, r.obsX, r.obsY, r.obsSize);
}

export class FluidSim {
  readonly dye = new Float32Array(FLUID_CELLS);
  readonly hue = new Float32Array(FLUID_CELLS);
  readonly vx = new Float32Array(FLUID_CELLS);
  readonly vy = new Float32Array(FLUID_CELLS);
  time = 0;

  private readonly scratch = new Float32Array(FLUID_CELLS);
  private readonly scratchB = new Float32Array(FLUID_CELLS);
  private readonly pressure = new Float32Array(FLUID_CELLS);
  private readonly div = new Float32Array(FLUID_CELLS);
  private readonly curl = new Float32Array(FLUID_CELLS);
  private inflowX = 0;

  clear(): void {
    this.dye.fill(0);
    this.hue.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
  }

  step(dt: number, resolved: ResolvedFluid, drive: FluidDrive): void {
    if (dt <= 0) return;
    this.time += dt;
    this.inflowX = Math.abs(resolved.windX) < 0.15 ? 0 : Math.max(-1.6, Math.min(1.6, resolved.windX));
    this.addForces(dt, resolved, drive);
    this.project(resolved.iterations);
    this.diffuse(1, this.vx, resolved.viscosity * resolved.viscosity * 0.02, dt, resolved.iterations);
    this.diffuse(2, this.vy, resolved.viscosity * resolved.viscosity * 0.02, dt, resolved.iterations);
    this.project(resolved.iterations);
    this.advect(1, this.vx, this.vx, this.vy, dt);
    this.advect(2, this.vy, this.vx, this.vy, dt);
    this.project(resolved.iterations);
    this.confine(dt, resolved.vorticity);
    this.applySolid(resolved);
    this.diffuse(0, this.dye, resolved.diffusion * 0.01, dt, resolved.iterations);
    this.diffuse(0, this.hue, resolved.diffusion * 0.01, dt, resolved.iterations);
    this.advect(0, this.dye, this.vx, this.vy, dt);
    this.advect(0, this.hue, this.vx, this.vy, dt);
    this.inject(dt, resolved);
    const fade = Math.exp(-resolved.dissipation * 0.85 * dt);
    for (let i = 0; i < FLUID_CELLS; i++) {
      this.dye[i] = clamp01((this.dye[i] ?? 0) * fade);
      if (!Number.isFinite(this.vx[i] ?? 0) || !Number.isFinite(this.vy[i] ?? 0)) {
        this.vx[i] = 0;
        this.vy[i] = 0;
      }
    }
    this.applySolid(resolved);
  }

  private addForces(dt: number, r: ResolvedFluid, drive: FluidDrive): void {
    const audioStir = r.audio === "stir" ? drive.audio : 0;
    const traffic = r.trafficStir ? drive.traffic : 0;
    const stirAng = this.time * (0.8 + r.stirrer);
    const sx = 0.5 + Math.cos(stirAng) * 0.28;
    const sy = 0.5 + Math.sin(stirAng * 0.8) * 0.22;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        if (cellSolid(i, j, r)) continue;
        const id = ix(i, j);
        const x = (i + 0.5) / FLUID_N;
        const y = (j + 0.5) / FLUID_N;
        let fx = r.windX + traffic * 0.8;
        let fy = r.windY + (this.dye[id] ?? 0) * r.gravity;
        const dx = x - 0.5;
        const dy = y - 0.5;
        fx += -dy * r.swirl * 2.2 - dy * audioStir * 1.4;
        fy += dx * r.swirl * 2.2 + dx * audioStir * 1.4;
        if (r.shear !== 0) fx += (y >= 0.5 ? 1 : -1) * r.shear;
        const pdx = x - sx;
        const pdy = y - sy;
        const pd = pdx * pdx + pdy * pdy;
        if (r.stirrer > 0 && pd < 0.08) {
          const k = (1 - pd / 0.08) * r.stirrer;
          fx += -pdy * k * 6;
          fy += pdx * k * 6;
        }
        this.vx[id] = (this.vx[id] ?? 0) + fx * dt * 1.6;
        this.vy[id] = (this.vy[id] ?? 0) + fy * dt * 1.6;
        const drag = Math.exp(-0.4 * dt);
        this.vx[id] = (this.vx[id] ?? 0) * drag;
        this.vy[id] = (this.vy[id] ?? 0) * drag;
        this.cap(id);
      }
    }
    if (drive.kick) this.splatVel(0.5, 0.45, 0, 1.6, 0.18);
    this.setBnd(1, this.vx);
    this.setBnd(2, this.vy);
  }

  private cap(id: number): void {
    const x = this.vx[id] ?? 0;
    const y = this.vy[id] ?? 0;
    const sp = Math.hypot(x, y);
    if (sp > 2.4) {
      const k = 2.4 / sp;
      this.vx[id] = x * k;
      this.vy[id] = y * k;
    }
  }

  private splatVel(x: number, y: number, vx: number, vy: number, radius: number): void {
    const cx = x * (FLUID_N - 1);
    const cy = y * (FLUID_N - 1);
    const rad = Math.max(0.8, radius * FLUID_N);
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const dx = i - cx;
        const dy = j - cy;
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * rad * rad));
        const id = ix(i, j);
        this.vx[id] = (this.vx[id] ?? 0) + vx * g;
        this.vy[id] = (this.vy[id] ?? 0) + vy * g;
        this.cap(id);
      }
    }
  }

  private inject(dt: number, r: ResolvedFluid): void {
    if (r.emitRate <= 0 || r.emitters.length === 0) return;
    for (const e of r.emitters) {
      const amount = 2.4 * dt * r.emitRate;
      const cx = e.x * (FLUID_N - 1);
      const cy = e.y * (FLUID_N - 1);
      const rad = Math.max(0.45, r.emitSize * FLUID_N);
      for (let j = 1; j < FLUID_N - 1; j++) {
        for (let i = 1; i < FLUID_N - 1; i++) {
          if (cellSolid(i, j, r)) continue;
          const dx = i - cx;
          const dy = j - cy;
          const g = Math.exp(-(dx * dx + dy * dy) / (2 * rad * rad));
          const id = ix(i, j);
          const add = amount * g;
          const prev = this.dye[id] ?? 0;
          const next = Math.min(1, prev + add);
          const hue = this.hue[id] ?? e.hue;
          this.hue[id] = next > 1e-5 ? (hue * prev + e.hue * add) / next : e.hue;
          this.dye[id] = next;
          this.vx[id] = (this.vx[id] ?? 0) + e.vx * add * 0.45;
          this.vy[id] = (this.vy[id] ?? 0) + e.vy * add * 0.45;
          this.cap(id);
        }
      }
    }
  }

  private confine(dt: number, eps: number): void {
    if (eps <= 0.001) return;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const id = ix(i, j);
        this.curl[id] = ((this.vy[ix(i + 1, j)] ?? 0) - (this.vy[ix(i - 1, j)] ?? 0)
          - ((this.vx[ix(i, j + 1)] ?? 0) - (this.vx[ix(i, j - 1)] ?? 0))) * 0.5;
      }
    }
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const dx = Math.abs(this.curl[ix(i + 1, j)] ?? 0) - Math.abs(this.curl[ix(i - 1, j)] ?? 0);
        const dy = Math.abs(this.curl[ix(i, j + 1)] ?? 0) - Math.abs(this.curl[ix(i, j - 1)] ?? 0);
        const len = Math.hypot(dx, dy) + 1e-5;
        const c = this.curl[ix(i, j)] ?? 0;
        const id = ix(i, j);
        this.vx[id] = (this.vx[id] ?? 0) + (dy / len) * c * eps * dt * 0.35;
        this.vy[id] = (this.vy[id] ?? 0) - (dx / len) * c * eps * dt * 0.35;
        this.cap(id);
      }
    }
  }

  private applySolid(r: ResolvedFluid): void {
    if (r.obstacle <= 0) return;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        if (!cellSolid(i, j, r)) continue;
        const id = ix(i, j);
        this.vx[id] = 0;
        this.vy[id] = 0;
        this.dye[id] = 0;
      }
    }
  }

  private setBnd(b: number, x: Float32Array): void {
    for (let i = 1; i < FLUID_N - 1; i++) {
      const open = this.inflowX !== 0;
      if (open && b === 1) {
        x[ix(0, i)] = this.inflowX;
        x[ix(FLUID_N - 1, i)] = x[ix(FLUID_N - 2, i)] ?? 0;
      } else if (open && b === 0) {
        x[ix(0, i)] = x[ix(1, i)] ?? 0;
        x[ix(FLUID_N - 1, i)] = x[ix(FLUID_N - 2, i)] ?? 0;
      } else {
        x[ix(0, i)] = b === 1 ? -(x[ix(1, i)] ?? 0) : (x[ix(1, i)] ?? 0);
        x[ix(FLUID_N - 1, i)] = b === 1 ? -(x[ix(FLUID_N - 2, i)] ?? 0) : (x[ix(FLUID_N - 2, i)] ?? 0);
      }
      x[ix(i, 0)] = b === 2 ? -(x[ix(i, 1)] ?? 0) : (x[ix(i, 1)] ?? 0);
      x[ix(i, FLUID_N - 1)] = b === 2 ? -(x[ix(i, FLUID_N - 2)] ?? 0) : (x[ix(i, FLUID_N - 2)] ?? 0);
    }
    x[ix(0, 0)] = 0.5 * ((x[ix(1, 0)] ?? 0) + (x[ix(0, 1)] ?? 0));
    x[ix(0, FLUID_N - 1)] = 0.5 * ((x[ix(1, FLUID_N - 1)] ?? 0) + (x[ix(0, FLUID_N - 2)] ?? 0));
    x[ix(FLUID_N - 1, 0)] = 0.5 * ((x[ix(FLUID_N - 2, 0)] ?? 0) + (x[ix(FLUID_N - 1, 1)] ?? 0));
    x[ix(FLUID_N - 1, FLUID_N - 1)] = 0.5 * ((x[ix(FLUID_N - 2, FLUID_N - 1)] ?? 0) + (x[ix(FLUID_N - 1, FLUID_N - 2)] ?? 0));
  }

  private linSolve(b: number, x: Float32Array, x0: Float32Array, a: number, c: number, iter: number): void {
    const inv = 1 / c;
    for (let k = 0; k < iter; k++) {
      for (let j = 1; j < FLUID_N - 1; j++) {
        for (let i = 1; i < FLUID_N - 1; i++) {
          const id = ix(i, j);
          x[id] = ((x0[id] ?? 0) + a * (
            (x[ix(i - 1, j)] ?? 0) + (x[ix(i + 1, j)] ?? 0) + (x[ix(i, j - 1)] ?? 0) + (x[ix(i, j + 1)] ?? 0)
          )) * inv;
        }
      }
      this.setBnd(b, x);
    }
  }

  private diffuse(b: number, x: Float32Array, diff: number, dt: number, iter: number): void {
    const a = dt * diff * (FLUID_N - 2) * (FLUID_N - 2);
    this.scratch.set(x);
    this.linSolve(b, x, this.scratch, a, 1 + 4 * a, iter);
  }

  private project(iter: number): void {
    const n = FLUID_N - 2;
    const h = 1 / n;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const id = ix(i, j);
        this.div[id] = -0.5 * h * (
          (this.vx[ix(i + 1, j)] ?? 0) - (this.vx[ix(i - 1, j)] ?? 0)
          + (this.vy[ix(i, j + 1)] ?? 0) - (this.vy[ix(i, j - 1)] ?? 0)
        );
        this.pressure[id] = 0;
      }
    }
    this.setBnd(0, this.div);
    this.setBnd(0, this.pressure);
    this.linSolve(0, this.pressure, this.div, 1, 4, iter);
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        const id = ix(i, j);
        this.vx[id] = (this.vx[id] ?? 0) - 0.5 * ((this.pressure[ix(i + 1, j)] ?? 0) - (this.pressure[ix(i - 1, j)] ?? 0)) / h;
        this.vy[id] = (this.vy[id] ?? 0) - 0.5 * ((this.pressure[ix(i, j + 1)] ?? 0) - (this.pressure[ix(i, j - 1)] ?? 0)) / h;
        this.cap(id);
      }
    }
    this.setBnd(1, this.vx);
    this.setBnd(2, this.vy);
  }

  private advect(b: number, d: Float32Array, vx: Float32Array, vy: Float32Array, dt: number): void {
    const dt0 = dt * (FLUID_N - 2);
    this.scratchB.set(d);
    const src = this.scratchB;
    for (let j = 1; j < FLUID_N - 1; j++) {
      for (let i = 1; i < FLUID_N - 1; i++) {
        let x = i - dt0 * (vx[ix(i, j)] ?? 0);
        let y = j - dt0 * (vy[ix(i, j)] ?? 0);
        if (x < 0.5) x = 0.5;
        if (x > FLUID_N - 1.5) x = FLUID_N - 1.5;
        if (y < 0.5) y = 0.5;
        if (y > FLUID_N - 1.5) y = FLUID_N - 1.5;
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const i1 = i0 + 1;
        const j1 = j0 + 1;
        const s1 = x - i0;
        const t1 = y - j0;
        const s0 = 1 - s1;
        const t0 = 1 - t1;
        d[ix(i, j)] = s0 * (t0 * (src[ix(i0, j0)] ?? 0) + t1 * (src[ix(i0, j1)] ?? 0))
          + s1 * (t0 * (src[ix(i1, j0)] ?? 0) + t1 * (src[ix(i1, j1)] ?? 0));
      }
    }
    this.setBnd(b, d);
  }
}

export function advanceFluid(sim: FluidSim, dt: number, opts: FluidOptions, drive: FluidDrive, mem: FluidMemory): void {
  if (mem.lastCharacter && mem.lastCharacter !== opts.character) sim.clear();
  mem.lastCharacter = opts.character;
  if (opts.clear === "go" && mem.lastClear !== "go") sim.clear();
  mem.lastClear = opts.clear;
  const resolved = resolveFluid(opts);
  const total = fluidDt(dt, opts);
  if (total <= 0) return;
  const n = Math.min(4, Math.max(1, Math.ceil(total / 0.02)));
  const h = total / n;
  for (let i = 0; i < n; i++) sim.step(h, resolved, i === 0 ? drive : { ...drive, kick: false });
}

export function packFluid(sim: FluidSim, opts: FluidOptions): Float32Array {
  const r = resolveFluid(opts);
  const flat = new Float32Array(512);
  flat[0] = 1;
  flat[1] = r.shade;
  flat[2] = r.palette;
  flat[3] = r.obstacle;
  flat[4] = r.obsSize;
  flat[5] = r.obsX;
  flat[6] = r.obsY;
  flat[7] = r.glow;
  flat[8] = r.foam;
  flat[9] = r.streamSteps;
  flat[10] = r.domain;
  flat[11] = r.vectors;
  flat[12] = r.gamma;
  flat[13] = r.detail;
  flat[14] = FLUID_N;
  flat[15] = FLUID_ORIGIN;
  flat[16] = sim.time;
  flat[17] = r.hue;
  const dyeAt = FLUID_ORIGIN;
  const hueAt = dyeAt + FLUID_CELLS;
  const vxAt = hueAt + FLUID_CELLS;
  const vyAt = vxAt + FLUID_CELLS;
  flat.set(sim.dye, dyeAt);
  flat.set(sim.hue, hueAt);
  flat.set(sim.vx, vxAt);
  flat.set(sim.vy, vyAt);
  return flat;
}

export function emptyFluidMemory(): FluidMemory {
  return { lastCharacter: "", lastClear: "hold" };
}

export function defaultFluidOptions(env?: { reducedMotion?: boolean }): FluidOptions {
  return parseFluidOptions({}, env);
}
