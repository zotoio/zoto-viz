import type { VizDataFrame } from "../../../sdk/viz-contract";
import {
  assignTalkerSlots,
  createTalkerSlotArrays,
  copyTalkerSlots,
  createTalkerSlotScratch,
  slottedTalkerIds,
  type SlotTalker,
  type TalkerSlot,
} from "../../../sdk/talker-slots";
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
  private readonly talkerScratch = createTalkerSlotScratch();
  private talkerBuffers = createTalkerSlotArrays(SLOT_CAP);
  private talkerRead: TalkerSlot[] = this.talkerBuffers[0];
  private talkerWrite: TalkerSlot[] = this.talkerBuffers[1];
  private reducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private motionListener: (() => void) | null = null;
  private warmed = false;
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
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  /** Snapshot of current slots (not the live double-buffer objects). */
  talkerSlotsArray(): TalkerSlot[] {
    return copyTalkerSlots(this.talkerRead);
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
    const byId = new Map<string, SlotTalker>();
    for (const t of frame.talkers) byId.set(t.id, { rate: t.rate });
    assignTalkerSlots(byId, this.talkerRead, this.talkerWrite, this.talkerScratch, this.simTime);
    const swap = this.talkerRead;
    this.talkerRead = this.talkerWrite;
    this.talkerWrite = swap;
  }

  private pack(frame: VizDataFrame, tileW: number, tileH: number): PackedFrame {
    const failed = clamp01(frame.sys?.failed ?? 0);
    const murk = failed > FAIL_MURK_THRESHOLD ? failed : 0;
    const ids = slottedTalkerIds(this.talkerRead);
    const s0 = this.slot0;
    s0.fill(0);
    for (let i = 0; i < SLOT_CAP; i++) {
      const slot = this.talkerRead[i];
      const rate = slot.id ? frame.talkers.find((t) => t.id === slot.id)?.rate ?? 0 : 0;
      s0[i] = slot.id ? Math.min(1, rate / 200) : 0;
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
    const bg: [number, number, number] = [0.14, 0.18, 0.32];
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
    const slotsCleared = slottedTalkerIds(this.talkerRead).length;
    this.talkerBuffers = createTalkerSlotArrays(SLOT_CAP);
    this.talkerRead = this.talkerBuffers[0];
    this.talkerWrite = this.talkerBuffers[1];
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
