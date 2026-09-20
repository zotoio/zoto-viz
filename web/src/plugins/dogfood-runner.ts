import type { StateMsg } from "../core/types";
import type { VizDemoPackId } from "../ui/viz-hud";
import { VIZ_DEMO_PACKS } from "../ui/viz-hud";
import { skipRatePerSec, vizHudMetric, type VizHudTick } from "../ui/viz-hud";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  VizFrameBudget,
  bindVizWriterCore,
  buildVizFrame,
  buildVizFrameForPlugin,
  parseVizContract,
  type VizDataFrame,
  type VizFrameBudgetStats,
  type VizPluginContract,
} from "./viz-host";
import { runPackFrameHandler, type VizPackHandlers } from "./viz-pack-host";

export { runPackFrameHandler };
export type DogfoodHostHandlers = VizPackHandlers;

/** Shipped viz contracts — mirrors plugins/src pack plugin.yml viz blocks. */
export const DEMO_PACK_CONTRACTS: Record<VizDemoPackId, VizPluginContract> = {
  "packet-tunnel": parseVizContract({
    graphWalk: false,
    maxBuffers: 2,
    maxBufferFloats: 16,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "rf-constellation": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 32,
    maxParticles: 0,
    uniforms: ["uTime", "uAudio", "uAccent", "uBg", "uOpacity"],
    idle: { fixture: "host" },
  })!,
  "talker-storm": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 8,
    maxParticles: 512,
    uniforms: ["uTime", "uBright", "uAudio"],
    idle: { fixture: "host" },
  })!,
  "kefrens-bars": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 32,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "roto-proto": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 8,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "blob-mesh": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 32,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "star-sines": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 16,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "hn-rain": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 64,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "hn-term": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 64,
    maxParticles: 0,
    uniforms: ["uTime", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "stereo-gram": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 32,
    maxParticles: 0,
    uniforms: ["uTime", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
  "nixie-clock": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 16,
    maxParticles: 0,
    uniforms: ["uTime", "uAudio", "uAccent", "uBg"],
    idle: { fixture: "host" },
  })!,
};

export interface DogfoodTickResult {
  delivered: boolean;
  frame: VizDataFrame | null;
  lastBuilt: VizDataFrame | null;
  stats: VizFrameBudgetStats;
  buildCalls: number;
}

export interface DogfoodPackStats {
  packId: VizDemoPackId;
  frames: number;
  delivered: number;
  skipped: number;
  buildMs: { p50: number; p95: number; max: number };
  skipRatePerSec: number;
  withinBudget: boolean;
  hudMetric: { label: string; value: string };
}

export interface DogfoodSoakResult {
  fixture: { devices: number; flows: number };
  budgetMs: number;
  framesPerPack: number;
  packs: DogfoodPackStats[];
  allWithinBudgetOrHonestSkips: boolean;
}

export function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

/**
 * One host tick on the viz hot path: a single `buildVizFrame` inside
 * `VizFrameBudget.deliver`, then the pack handler when under budget.
 * Returns build-call count so tests can assert HUD never triggers a second build.
 */
export function dogfoodTick(
  packId: VizDemoPackId,
  state: StateMsg,
  prevTs: number,
  audio: number,
  budget: VizFrameBudget,
  writer: VizBufferWriter,
  buildSpy?: { calls: number },
  build: typeof buildVizFrame = buildVizFrame,
): DogfoodTickResult {
  const contract = DEMO_PACK_CONTRACTS[packId];
  const idleBuild = (s: StateMsg, pt: number, a: number) => buildVizFrameForPlugin(s, pt, a, contract.idle);
  let buildCalls = 0;
  const wrappedBuild = (s: StateMsg, pt: number, a: number) => {
    buildCalls++;
    if (buildSpy) buildSpy.calls++;
    return build === buildVizFrame ? idleBuild(s, pt, a) : build(s, pt, a);
  };

  const handlers: DogfoodHostHandlers = {
    writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
    writeUniform: (name, value) => { writer.writeUniform(name, value); },
    writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
  };

  const frame = budget.deliver(state, prevTs, audio, (f) => runPackFrameHandler(packId, f, handlers), wrappedBuild);
  return {
    delivered: frame !== null,
    frame,
    lastBuilt: budget.lastBuilt,
    stats: budget.stats,
    buildCalls,
  };
}

/** Host rebind used on demo pack swap (mirrors main.ts bindVizWriter). */
export function hostBindOnPackSwap(
  writer: VizBufferWriter | null,
  contract: VizPluginContract,
  frameTs: number,
  budget: VizFrameBudget,
  preserveUbo: boolean,
): { writer: VizBufferWriter | null; frameTs: number; budget: VizFrameBudget } {
  const result = bindVizWriterCore(writer, contract, preserveUbo);
  return {
    writer: result.writer,
    frameTs: result.resetFrameTs ? 0 : frameTs,
    budget: result.resetBudget ? (budget.reset(), budget) : budget,
  };
}

/** Rolling HUD tick input — uses only budget stats + lastBuilt (no extra build). */
export function hudTickFromBudget(
  packId: VizDemoPackId,
  packName: string,
  state: StateMsg,
  budget: VizFrameBudget,
  now: number,
): VizHudTick {
  return {
    packId,
    packName,
    stats: budget.stats,
    frame: budget.lastBuilt,
    state,
    now,
  };
}

export interface DogfoodSoakOptions {
  state?: StateMsg;
  framesPerPack?: number;
  audio?: number;
  now?: () => number;
  /** Synthetic vsync step for soft-FPS honesty tests (present-to-present skips). */
  presentStepMs?: number;
}

/** Gate helper: never pass on fast CPU build alone when present time is over budget. */
export function dogfoodWithinBudget(
  buildP95: number,
  presentP95: number,
  skipped: number,
): boolean {
  const buildOk = buildP95 <= VIZ_FRAME_BUDGET_MS;
  const presentOk = presentP95 <= VIZ_FRAME_BUDGET_MS;
  return (buildOk && presentOk) || skipped > 0;
}

/**
 * Live dogfood soak: fat-LAN fixture, all three packs, real `performance.now`
 * budget path. Passes when p95 build and present are within budget or skips are
 * recorded (never silent green on soft-FPS).
 */
export function runDogfoodSoak(opts: DogfoodSoakOptions = {}): DogfoodSoakResult {
  const state = opts.state ?? fatLanFixture();
  const framesPerPack = opts.framesPerPack ?? 120;
  const audio = opts.audio ?? 0.15;
  const now = opts.now ?? (() => performance.now());
  const presentStepMs = opts.presentStepMs;

  const packs: DogfoodPackStats[] = [];

  for (const packId of VIZ_DEMO_PACKS) {
    const contract = DEMO_PACK_CONTRACTS[packId];
    const budget = new VizFrameBudget(now);
    const writer = new VizBufferWriter(contract);
    const buildTimes: number[] = [];
    const presentTimes: number[] = [];
    let prevTs = 0;
    let delivered = 0;
    let skippedStart = 0;
    const skipSamples: { t: number; n: number }[] = [];
    const t0 = now();
    let presentT = 0;

    for (let i = 0; i < framesPerPack; i++) {
      const tickT0 = now();
      const tick = dogfoodTick(packId, state, prevTs, audio, budget, writer);
      buildTimes.push(now() - tickT0);
      if (tick.delivered && tick.frame) {
        delivered++;
        prevTs = tick.frame.t;
      }
      if (presentStepMs != null) {
        presentT += presentStepMs;
        const presentT0 = now();
        budget.markPresent(presentT);
        presentTimes.push(now() - presentT0);
      }
      const delta = budget.stats.skipped - skippedStart;
      if (delta > 0) {
        skipSamples.push({ t: now(), n: delta });
        skippedStart = budget.stats.skipped;
      }
    }

    const skipped = budget.stats.skipped;
    const p95 = percentile(buildTimes, 0.95);
    const presentP95 = presentStepMs != null
      ? presentStepMs
      : percentile(presentTimes, 0.95);
    const withinBudget = dogfoodWithinBudget(p95, presentP95, skipped);
    const lastHud = hudTickFromBudget(packId, packId, state, budget, now());
    const metric = vizHudMetric(packId, lastHud.frame, state);

    packs.push({
      packId,
      frames: framesPerPack,
      delivered,
      skipped,
      buildMs: {
        p50: percentile(buildTimes, 0.5),
        p95,
        max: buildTimes.length ? Math.max(...buildTimes) : 0,
      },
      skipRatePerSec: skipRatePerSec(skipSamples, now()),
      withinBudget,
      hudMetric: metric,
    });
  }

  return {
    fixture: { devices: state.devices.length, flows: state.flows.length },
    budgetMs: VIZ_FRAME_BUDGET_MS,
    framesPerPack,
    packs,
    allWithinBudgetOrHonestSkips: packs.every((p) => p.withinBudget),
  };
}

/** Mid-run pack swap sequence: preserve vizFrameTs, skip counters, and UBO mirror. */
export function runPackSwapPreserve(
  state: StateMsg,
  fromPack: VizDemoPackId,
  toPack: VizDemoPackId,
  now: () => number = () => performance.now(),
): {
  frameTs: number;
  skipped: number;
  uboMatch: boolean;
} {
  const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[fromPack]);
  writer.writeBuffer(0, [1, 2, 3, 4]);

  const budget = new VizFrameBudget(now);
  let frameTs = 0;
  const tick1 = dogfoodTick(fromPack, state, frameTs, 0.1, budget, writer);
  if (tick1.frame) frameTs = tick1.frame.t;

  dogfoodTick(fromPack, state, frameTs, 0.1, budget, writer);
  const uboBeforeSwap = writer.ubo.slice();

  const bound = hostBindOnPackSwap(
    writer,
    DEMO_PACK_CONTRACTS[toPack],
    frameTs,
    budget,
    true,
  );
  const nextWriter = bound.writer!;
  frameTs = bound.frameTs;
  const uboMatch = Array.from(nextWriter.ubo).every((v, i) => v === uboBeforeSwap[i]);

  dogfoodTick(toPack, state, frameTs, 0.1, budget, nextWriter);

  return {
    frameTs,
    skipped: budget.stats.skipped,
    uboMatch,
  };
}

export function formatDogfoodReport(result: DogfoodSoakResult): string {
  const lines = [
    `Fat-LAN dogfood (${result.fixture.devices} devices, ${result.fixture.flows} flows, budget ${result.budgetMs} ms, ${result.framesPerPack} frames/pack):`,
  ];
  for (const p of result.packs) {
    const skipNote = p.skipped > 0 ? `skips ${p.skipRatePerSec.toFixed(1)}/s (${p.skipped} total)` : "skips 0/s";
    lines.push(
      `  ${p.packId}: build p50=${p.buildMs.p50.toFixed(2)}ms p95=${p.buildMs.p95.toFixed(2)}ms max=${p.buildMs.max.toFixed(2)}ms | ${skipNote} | HUD ${p.hudMetric.label}=${p.hudMetric.value}`,
    );
  }
  lines.push(`  gate: ${result.allWithinBudgetOrHonestSkips ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
