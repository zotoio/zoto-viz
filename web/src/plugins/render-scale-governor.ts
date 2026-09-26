import { VIZ_FRAME_BUDGET_MS } from "./viz-host";

export const DEFAULT_RENDER_SCALE_STEPS = [1, 0.75, 0.5, 0.35] as const;
export const RENDER_SCALE_STEP_DOWN_MS = 500;
export const RENDER_SCALE_STEP_UP_MS = 2000;
export const RENDER_SCALE_UP_RATIO = 0.8;

export interface RenderScaleConfig {
  min: number;
  steps: readonly number[];
}

export interface RenderScaleGovernorClock {
  now(): number;
}

export interface RenderScaleGovernorInput {
  now: number;
  /** Present or GPU p95 over the budget window — ms. */
  p95Ms: number;
  budgetMs: number;
}

export interface RenderScaleGovernorState {
  scaleIndex: number;
  scale: number;
  overSince: number;
  underSince: number;
}

/** Per-tick proposal before a page arbiter may commit a step (multi-view). */
export interface RenderScaleGovernorProposal {
  /** Applied scale after any commit this tick. */
  scale: number;
  stepDownReady: boolean;
  stepUpReady: boolean;
  /** How far p95 is above the pane budget share (ms); used to rank step-down winner. */
  overshootMs: number;
  /** Latest p95 sample (ms); used to rank step-up (cheapest first). */
  costMs: number;
}

function normalizeSteps(raw: readonly number[], min: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    if (!Number.isFinite(v) || v <= 0 || v > 1) continue;
    const clamped = Math.max(min, v);
    const key = Math.round(clamped * 10000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clamped);
  }
  out.sort((a, b) => b - a);
  if (!out.length) out.push(1);
  if (out[0]! < 1) out.unshift(1);
  else if (out[0]! > 1) out[0] = 1;
  return out;
}

export function parseRenderScaleConfig(raw: unknown): RenderScaleConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  const minRaw = typeof doc.min === "number" ? doc.min : Number(doc.min);
  if (!Number.isFinite(minRaw) || minRaw <= 0 || minRaw > 1) return undefined;
  const min = minRaw;
  let steps: number[];
  if (Array.isArray(doc.steps)) {
    steps = normalizeSteps(doc.steps as number[], min);
  } else {
    steps = normalizeSteps(DEFAULT_RENDER_SCALE_STEPS, min);
  }
  return { min, steps };
}

export class RenderScaleGovernor {
  private readonly steps: readonly number[];
  private readonly budgetMs: number;
  private readonly clock: RenderScaleGovernorClock;
  private index = 0;
  private overSince = -1;
  private underSince = -1;

  constructor(
    config: RenderScaleConfig,
    clock: RenderScaleGovernorClock = { now: () => performance.now() },
    budgetMs = VIZ_FRAME_BUDGET_MS,
  ) {
    this.steps = config.steps;
    this.clock = clock;
    this.budgetMs = budgetMs;
  }

  get scale(): number {
    return this.steps[this.index] ?? 1;
  }

  get scaleIndex(): number {
    return this.index;
  }

  snapshot(): RenderScaleGovernorState {
    return {
      scaleIndex: this.index,
      scale: this.scale,
      overSince: this.overSince,
      underSince: this.underSince,
    };
  }

  reset(): void {
    this.index = 0;
    this.overSince = -1;
    this.underSince = -1;
  }

  /**
   * Advance hysteresis timers and report whether a step is ready.
   * Does not change scale until {@link commitStepDown} / {@link commitStepUp}.
   */
  evaluate(input: RenderScaleGovernorInput): RenderScaleGovernorProposal {
    const now = input.now;
    const budget = input.budgetMs > 0 ? input.budgetMs : this.budgetMs;
    const p95 = input.p95Ms;
    const over = p95 > budget;
    const comfortableUnder = p95 < budget * RENDER_SCALE_UP_RATIO;
    let stepDownReady = false;
    let stepUpReady = false;

    if (over) {
      if (this.overSince < 0) this.overSince = now;
      this.underSince = -1;
      if (now - this.overSince >= RENDER_SCALE_STEP_DOWN_MS && this.index < this.steps.length - 1) {
        stepDownReady = true;
      }
    } else if (comfortableUnder) {
      if (this.underSince < 0) this.underSince = now;
      this.overSince = -1;
      if (now - this.underSince >= RENDER_SCALE_STEP_UP_MS && this.index > 0) {
        stepUpReady = true;
      }
    } else {
      this.overSince = -1;
      this.underSince = -1;
    }

    return {
      scale: this.scale,
      stepDownReady,
      stepUpReady,
      overshootMs: p95 - budget,
      costMs: p95,
    };
  }

  commitStepDown(now: number): number {
    if (this.index >= this.steps.length - 1) return this.scale;
    this.index++;
    this.overSince = now;
    this.underSince = -1;
    return this.scale;
  }

  commitStepUp(now: number): number {
    if (this.index <= 0) return this.scale;
    this.index--;
    this.underSince = now;
    this.overSince = -1;
    return this.scale;
  }

  /** Advance hysteresis from one timing sample window (single-view / tests). */
  tick(input: RenderScaleGovernorInput): number {
    const proposal = this.evaluate(input);
    if (proposal.stepDownReady) this.commitStepDown(input.now);
    else if (proposal.stepUpReady) this.commitStepUp(input.now);
    return this.scale;
  }
}
