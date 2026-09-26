import type { VizDataFrame } from "../../../sdk/viz-contract";
import { assignTalkerSlots, slottedTalkerIds, type TalkerSlot } from "../../../sdk/talker-slots";
import type { StarterOptions } from "./config";

const FIXED_DT = 1 / 60;
const MAX_CATCHUP_STEPS = 4;
const FAIL_MURK_THRESHOLD = 0.35;
const SLOT_CAP = 4;

export type TeardownCounts = {
  slotsCleared: number;
  listenersRemoved: number;
};

export type PackedFrame = {
  slot0: Float32Array;
  bright: number;
  accent: [number, number, number];
  bg: [number, number, number];
  labelMetric: string;
  smokeLuma: number;
};

export class StarterSim {
  private opts: StarterOptions;
  private simTime = 0;
  private accumulator = 0;
  private talkerSlots: (TalkerSlot | null)[] = Array.from({ length: SLOT_CAP }, () => null);
  private reducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private motionListener: (() => void) | null = null;
  private warmed = false;
  private slotArrayReplaced = 0;
  readonly slot0 = new Float32Array(32);

  constructor(opts: StarterOptions) {
    this.opts = opts;
    this.bindReducedMotion();
  }

  setOptions(opts: StarterOptions): void {
    this.opts = opts;
  }

  private bindReducedMotion(): void {
    if (typeof matchMedia !== "function") return;
    this.motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      this.reducedMotion = this.motionQuery?.matches ?? false;
    };
    apply();
    this.motionListener = apply;
    this.motionQuery.addEventListener("change", this.motionListener);
  }

  warm(frame: VizDataFrame, tileW: number, tileH: number): void {
    for (let i = 0; i < 8; i++) this.advance(frame, tileW, tileH);
    this.warmed = true;
    this.slotArrayReplaced = 0;
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  slotArrayReplacedSinceWarm(): number {
    return this.slotArrayReplaced;
  }

  advance(frame: VizDataFrame, tileW: number, tileH: number): PackedFrame {
    const dt = Number.isFinite(frame.dt) ? Math.min(0.25, Math.max(0, frame.dt)) : FIXED_DT;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      this.simTime += FIXED_DT;
      this.stepSim(frame);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 0 && this.accumulator > 0) {
      this.simTime += this.accumulator;
      this.stepSim(frame);
      this.accumulator = 0;
    }
    return this.pack(frame, tileW, tileH);
  }

  private stepSim(frame: VizDataFrame): void {
    const talkers = frame.talkers.map((t) => ({ id: t.id, rate: t.rate }));
    const prevRef = this.talkerSlots;
    const next = assignTalkerSlots(talkers, this.talkerSlots, SLOT_CAP, this.simTime);
    for (let i = 0; i < SLOT_CAP; i++) this.talkerSlots[i] = next[i] ?? null;
    if (this.warmed && prevRef !== this.talkerSlots) this.slotArrayReplaced++;
  }

  private pack(frame: VizDataFrame, tileW: number, tileH: number): PackedFrame {
    const failed = clamp01(frame.sys?.failed ?? 0);
    const murk = failed > FAIL_MURK_THRESHOLD ? failed : 0;
    const ids = slottedTalkerIds(this.talkerSlots);
    const s0 = this.slot0;
    s0.fill(0);
    for (let i = 0; i < SLOT_CAP; i++) {
      const slot = this.talkerSlots[i];
      s0[i] = slot ? Math.min(1, slot.rate / 200) : 0;
    }
    s0[8] = murk;
    s0[4] = frame.demo ? 1 : 0;
    s0[5] = tileW;
    s0[6] = tileH;
    s0[7] = this.reducedMotion ? 1 : 0;

    const motion = this.reducedMotion ? 0.15 : 0.55 + frame.audio * 0.35;
    const accent: [number, number, number] = murk > 0
      ? [0.85, 0.2, 0.15]
      : [0.25, 0.75, 0.95];
    const bg: [number, number, number] = [0.04, 0.06, 0.12];
    const metric = liveMetric(frame, ids.length);
    const smokeLuma = murk * 0.6 + (frame.demo ? 0.05 : 0) + s0[0] * 0.2;
    return {
      slot0: s0,
      bright: motion,
      accent,
      bg,
      labelMetric: cornerLabel(this.opts.displayName, metric, frame.demo === true),
      smokeLuma,
    };
  }

  teardown(): TeardownCounts {
    let listenersRemoved = 0;
    if (this.motionQuery && this.motionListener) {
      this.motionQuery.removeEventListener("change", this.motionListener);
      listenersRemoved = 1;
    }
    this.motionQuery = null;
    this.motionListener = null;
    const slotsCleared = this.talkerSlots.filter(Boolean).length;
    this.talkerSlots = [];
    this.warmed = false;
    this.simTime = 0;
    this.accumulator = 0;
    return { slotsCleared, listenersRemoved };
  }
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function liveMetric(frame: VizDataFrame, slotted: number): string {
  const failed = clamp01(frame.sys?.failed ?? 0);
  if (failed > FAIL_MURK_THRESHOLD) return "fail";
  if (!frame.talkers.length) return "idle";
  let peak = 0;
  for (const t of frame.talkers) peak = Math.max(peak, t.rate);
  return `slots:${slotted} · ${Math.round(peak)}pps`;
}

export function cornerLabel(displayName: string, metric: string, demo: boolean): string {
  const metricPart = demo ? `${metric} · demo` : metric;
  return `${displayName} · ${metricPart}`;
}
