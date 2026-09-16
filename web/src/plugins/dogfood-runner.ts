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
  parseVizContract,
  type VizDataFrame,
  type VizFrameBudgetStats,
  type VizPluginContract,
  type VizUniformValue,
} from "./viz-host";

/** Shipped viz contracts — mirrors plugins/src pack plugin.yml viz blocks. */
export const DEMO_PACK_CONTRACTS: Record<VizDemoPackId, VizPluginContract> = {
  "packet-tunnel": parseVizContract({
    graphWalk: false,
    maxBuffers: 2,
    maxBufferFloats: 16,
    maxParticles: 0,
    uniforms: ["uTime", "uBright", "uAccent", "uBg"],
  })!,
  "rf-constellation": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 32,
    maxParticles: 0,
    uniforms: ["uTime", "uAudio", "uAccent", "uBg", "uOpacity"],
  })!,
  "talker-storm": parseVizContract({
    graphWalk: false,
    maxBuffers: 1,
    maxBufferFloats: 8,
    maxParticles: 512,
    uniforms: ["uTime", "uBright", "uAudio"],
  })!,
};

export interface DogfoodHostHandlers {
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: VizUniformValue) => void;
  writeParticles: (data: number[], stride?: number) => void;
}

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

function tunnelHue(field: number): [number, number, number] {
  return [0.15 + field * 0.7, 0.35 + field * 0.4, 0.85 - field * 0.3];
}

function roleHue(role: string): number {
  if (role === "gateway") return 0.9;
  if (role === "internet") return 0.75;
  if (role === "lan") return 0.45;
  return 0.2;
}

/** Host-side mirror of pack frontend onFrame handlers (no iframe). */
export function runPackFrameHandler(
  packId: VizDemoPackId,
  frame: VizDataFrame,
  handlers: DogfoodHostHandlers,
): void {
  switch (packId) {
    case "packet-tunnel": {
      const lead = frame.packets[0]?.field ?? 0;
      const depth = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
      handlers.writeBuffer(0, [lead, depth, frame.t % 1]);
      handlers.writeUniform("uBright", 0.55 + depth * 0.35);
      handlers.writeUniform("uAccent", tunnelHue(lead));
      break;
    }
    case "rf-constellation": {
      const beacons = frame.rf;
      const buf: number[] = [];
      for (let i = 0; i < Math.min(8, beacons.length); i++) {
        const b = beacons[i]!;
        buf.push(b.rssi, b.channel / 165, i / 8);
      }
      handlers.writeBuffer(0, buf);
      const avg = beacons.reduce((s, b) => s + b.rssi, 0) / Math.max(1, beacons.length);
      handlers.writeUniform("uAudio", Math.min(1, frame.audio + avg * 0.25));
      handlers.writeUniform("uAccent", [0.2 + avg * 0.6, 0.45, 0.95 - avg * 0.3]);
      handlers.writeUniform("uOpacity", 0.65 + avg * 0.25);
      break;
    }
    case "talker-storm": {
      const particles: number[] = [];
      let count = 0;
      for (const talker of frame.talkers) {
        const n = Math.min(8, Math.ceil(talker.rate / 40));
        for (let i = 0; i < n && count < 512; i++, count++) {
          const hash = (talker.id.charCodeAt(0) + i * 17) % 97;
          particles.push(
            (hash / 97) * 2 - 1,
            roleHue(talker.role),
            (frame.t % 1) + i * 0.01,
            Math.min(1, talker.rate / 200),
          );
        }
      }
      handlers.writeParticles(particles, 4);
      handlers.writeBuffer(0, [count, frame.audio, frame.t % 1]);
      handlers.writeUniform("uBright", 0.4 + frame.audio * 0.5);
      handlers.writeUniform("uAudio", frame.audio);
      break;
    }
  }
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
  let buildCalls = 0;
  const wrappedBuild = (s: StateMsg, pt: number, a: number) => {
    buildCalls++;
    if (buildSpy) buildSpy.calls++;
    return build(s, pt, a);
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
}

/**
 * Live dogfood soak: fat-LAN fixture, all three packs, real `performance.now`
 * budget path. Passes when p95 build ≤ budget or skips are recorded (never silent green).
 */
export function runDogfoodSoak(opts: DogfoodSoakOptions = {}): DogfoodSoakResult {
  const state = opts.state ?? fatLanFixture();
  const framesPerPack = opts.framesPerPack ?? 120;
  const audio = opts.audio ?? 0.15;
  const now = opts.now ?? (() => performance.now());

  const packs: DogfoodPackStats[] = [];

  for (const packId of VIZ_DEMO_PACKS) {
    const contract = DEMO_PACK_CONTRACTS[packId];
    const budget = new VizFrameBudget(now);
    const writer = new VizBufferWriter(contract);
    const buildTimes: number[] = [];
    let prevTs = 0;
    let delivered = 0;
    let skippedStart = 0;
    const skipSamples: { t: number; n: number }[] = [];
    const t0 = now();

    for (let i = 0; i < framesPerPack; i++) {
      const tickT0 = now();
      const tick = dogfoodTick(packId, state, prevTs, audio, budget, writer);
      buildTimes.push(now() - tickT0);
      if (tick.delivered && tick.frame) {
        delivered++;
        prevTs = tick.frame.t;
      }
      const delta = budget.stats.skipped - skippedStart;
      if (delta > 0) {
        skipSamples.push({ t: now(), n: delta });
        skippedStart = budget.stats.skipped;
      }
    }

    const skipped = budget.stats.skipped;
    const p95 = percentile(buildTimes, 0.95);
    const withinBudget = p95 <= VIZ_FRAME_BUDGET_MS || skipped > 0;
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
