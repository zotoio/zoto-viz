import type { StateMsg } from "../core/types";
import { resetVizClockInjectors, setVizBuildCostInjector, vizClockMs } from "../core/viz-clock"
import { monoMs } from "../core/viz-time";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";
import type { VizDemoPackId } from "../ui/viz-hud";
import { VIZ_DEMO_PACKS } from "../ui/viz-hud";
import { unavailablePackForView } from "./plugin-unavailable";
import { skipRatePerSec, vizHudMetric, type VizHudTick } from "../ui/viz-hud";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING,
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
import { bumpFrameObject, takeVizBuildWorkSnapshot, type VizBuildWorkCounters } from "./viz-build-counters";
import { assertVizBuildWorkGates, assertVizFrameOutputCaps } from "./viz-gate-assertions";
import { runPackFrameHandler, type VizPackHandlers } from "./viz-pack-host";

export { runPackFrameHandler };

/** #169: the demo packs dogfood runs; a pack the catalog lists as unavailable is skipped silently. */
export function dogfoodPackIds(): VizDemoPackId[] {
  return VIZ_DEMO_PACKS.filter((id) => !unavailablePackForView(`plugin:${id}`));
}
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
    maxBuffers: 8,
    maxBufferFloats: 64,
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

export interface DogfoodCountGatePackResult {
  packId: VizDemoPackId;
  frames: number;
  delivered: number;
  skipped: number;
  maxWork: VizBuildWorkCounters;
}

export interface DogfoodCountGateResult {
  fixture: { devices: number; flows: number };
  framesPerPack: number;
  packs: DogfoodCountGatePackResult[];
  ok: boolean;
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
  prevVizClockMs: import("../core/viz-time").MonoMs,
  audio: number,
  budget: VizFrameBudget,
  writer: VizBufferWriter,
  buildSpy?: { calls: number },
  build: typeof buildVizFrame = buildVizFrame,
): DogfoodTickResult {
  const contract = DEMO_PACK_CONTRACTS[packId];
  const idleBuild = (s: StateMsg, pt: import("../core/viz-time").MonoMs, a: number) => buildVizFrameForPlugin(s, pt, a, contract.idle);
  let buildCalls = 0;
  const wrappedBuild = (s: StateMsg, pt: import("../core/viz-time").MonoMs, a: number) => {
    buildCalls++;
    if (buildSpy) buildSpy.calls++;
    return build === buildVizFrame ? idleBuild(s, pt, a) : build(s, pt, a);
  };

  const handlers: DogfoodHostHandlers = {
    writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
    writeUniform: (name, value) => { writer.writeUniform(name, value); },
    writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
  };

  const frame = budget.deliver(state, prevVizClockMs, audio, (f) => runPackFrameHandler(packId, f, handlers), wrappedBuild);
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

/** Frames per pack in the fat-LAN deterministic soak (count gate, not wall time). */
export const DOGFOOD_SOAK_FRAMES_PER_PACK = 120;

/** Simulated host clock step — 60 Hz (ms). */
export const DOGFOOD_SOAK_CLOCK_STEP_MS = 1000 / 60;

/** Monitor fixture event period — one StateMsg tick per deliver at 60 Hz (ms). */
export const DOGFOOD_SOAK_EVENT_PERIOD_MS = 1000 / 60;

/**
 * Injected per-deliver build cost (ms) for the fat-LAN soak. Hand-worked skips:
 * 120 delivers × 4 ms ≤ 16.7 ms budget → 0 over-budget → skipped = 0, delivered = 120.
 * HUD skip rate at simulated t = 120 × (1000/60) ms ≈ 2 s with 0 skip deltas → 0/s.
 */
export const DOGFOOD_SOAK_BUILD_COST_MS = 4;

/** Injected build cost on every third deliver (0-based index i where i % 3 === 2). */
export const DOGFOOD_SOAK_OVER_BUDGET_BUILD_COST_MS = 20;

export const DOGFOOD_SOAK_PATTERN_PERIOD = 3;

export function dogfoodSoakPatternedBuildCostMs(index: number): number {
  return index % DOGFOOD_SOAK_PATTERN_PERIOD === 2
    ? DOGFOOD_SOAK_OVER_BUDGET_BUILD_COST_MS
    : DOGFOOD_SOAK_BUILD_COST_MS;
}

/**
 * Tile cadence hand-work (see TILE_BUDGET_R4_PATTERN): 100 delivered, 20 skipped at 120 frames.
 */
export const DOGFOOD_SOAK_PATTERN_EXPECTED = {
  delivered: 100,
  skipped: 20,
  /** Skip deltas in the final 1000 ms HUD window (20 total over 2 s). */
  skipRatePerSec: 20,
} as const;

export interface DogfoodSoakOptions {
  state?: StateMsg;
  framesPerPack?: number;
  audio?: number;
  now?: () => number;
  /** Advance `simTimeMs.value` by this much after each deliver (deterministic soak). */
  clockStepMs?: number;
  /** Backing store for `now()` when running on a simulated clock. */
  simTimeMs?: { value: number };
  /** Advance `state.ts` by this period each deliver (fixture event rate). */
  eventPeriodMs?: number;
  /** Fixed or per-index build ms; bypasses wall-clock measurement in {@link VizFrameBudget}. */
  buildCostMs?: number | readonly number[] | ((index: number) => number);
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

function resolveBuildCostInjector(
  buildCostMs: DogfoodSoakOptions["buildCostMs"],
): ((index: number) => number) | undefined {
  if (buildCostMs == null) return undefined;
  if (typeof buildCostMs === "number") return () => buildCostMs;
  if (typeof buildCostMs === "function") return buildCostMs;
  const table = buildCostMs;
  return (index) => table[Math.min(index, table.length - 1)]!;
}

function buildCostSample(
  buildCostMs: DogfoodSoakOptions["buildCostMs"],
  index: number,
  measuredMs: number,
): number {
  const inject = resolveBuildCostInjector(buildCostMs);
  return inject ? inject(index) : measuredMs;
}

/**
 * Deterministic dogfood gate for cloud CI (`dogfood` job): injected zero clock,
 * strict delivered/skipped counts, per-build work budgets, output caps.
 */
export function runDogfoodCountGate(opts: DogfoodSoakOptions = {}): DogfoodCountGateResult {
  const baseState = opts.state ?? fatLanFixture();
  const framesPerPack = opts.framesPerPack ?? DOGFOOD_SOAK_FRAMES_PER_PACK;
  const audio = opts.audio ?? 0.15;
  const now = opts.now ?? (() => 0);

  const packs: DogfoodCountGatePackResult[] = [];
  let ok = true;

  for (const packId of dogfoodPackIds()) {
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["dogfood"]);
    const contract = DEMO_PACK_CONTRACTS[packId];
    const budget = new VizFrameBudget(now, "dogfood");
    const writer = new VizBufferWriter(contract);
    const maxWork: VizBuildWorkCounters = {
      flowVisits: 0,
      flowProtoVisits: 0,
      rateCalls: 0,
      talkerObjectsCreated: 0,
      packetObjectsCreated: 0,
      frameObjectsCreated: 0,
    };
    let prevVizClockMs = monoMs(0);
    let delivered = 0;

    const gatedBuild: typeof buildVizFrame = (s, pt = monoMs(0), a = 0, bind) => {
      const frame = buildVizFrameForPlugin(s, pt, a, contract.idle, 1, bind);
      bumpFrameObject();
      const work = takeVizBuildWorkSnapshot();
      maxWork.flowVisits = Math.max(maxWork.flowVisits, work.flowVisits);
      maxWork.flowProtoVisits = Math.max(maxWork.flowProtoVisits, work.flowProtoVisits);
      maxWork.rateCalls = Math.max(maxWork.rateCalls, work.rateCalls);
      maxWork.talkerObjectsCreated = Math.max(maxWork.talkerObjectsCreated, work.talkerObjectsCreated);
      maxWork.packetObjectsCreated = Math.max(maxWork.packetObjectsCreated, work.packetObjectsCreated);
      maxWork.frameObjectsCreated = Math.max(maxWork.frameObjectsCreated, work.frameObjectsCreated);
      try {
        assertVizBuildWorkGates(s, work);
        assertVizFrameOutputCaps(frame, {
          checkDecimation: false,
          encodedByteCeiling: FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING,
        });
      } catch {
        ok = false;
      }
      return frame;
    };

    for (let i = 0; i < framesPerPack; i++) {
      const tick = dogfoodTick(packId, baseState, prevVizClockMs, audio, budget, writer, undefined, gatedBuild);
      if (tick.delivered && tick.frame) {
        delivered++;
        prevVizClockMs = monoMs(tick.frame.t);
      }
    }

    const skipped = budget.stats.skipped;
    if (delivered !== framesPerPack || skipped !== 0) ok = false;
    try {
      assertVizBuildWorkGates(baseState, maxWork);
    } catch {
      ok = false;
    }

    packs.push({ packId, frames: framesPerPack, delivered, skipped, maxWork });
  }

  return {
    fixture: { devices: baseState.devices.length, flows: baseState.flows.length },
    framesPerPack,
    packs,
    ok,
  };
}

export function formatDogfoodCountGateReport(result: DogfoodCountGateResult): string {
  const lines = [
    `Fat-LAN dogfood count gate (${result.fixture.devices} devices, ${result.fixture.flows} flows, ${result.framesPerPack} frames/pack):`,
  ];
  for (const p of result.packs) {
    const w = p.maxWork;
    lines.push(
      `  ${p.packId}: delivered ${p.delivered}/${p.frames} skips=${p.skipped} | rateCalls=${w.rateCalls} flowVisits=${w.flowVisits}`,
    );
  }
  lines.push(`  gate: ${result.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

/**
 * Dogfood soak: fat-LAN fixture, all demo packs. Use {@link buildCostMs} +
 * injected `now` for deterministic count gates; omit build costs only on local GPU runs.
 */
export function runDogfoodSoak(opts: DogfoodSoakOptions = {}): DogfoodSoakResult {
  const baseState = opts.state ?? fatLanFixture();
  const framesPerPack = opts.framesPerPack ?? DOGFOOD_SOAK_FRAMES_PER_PACK;
  const audio = opts.audio ?? 0.15;
  const now = opts.now ?? vizClockMs;
  const presentStepMs = opts.presentStepMs;
  const clockStepMs = opts.clockStepMs;
  const eventPeriodMs = opts.eventPeriodMs;
  const buildCostOpt = opts.buildCostMs;
  const simTimeMs = opts.simTimeMs;

  const costInjector = resolveBuildCostInjector(buildCostOpt);
  if (costInjector) setVizBuildCostInjector(costInjector);

  try {
    const packs: DogfoodPackStats[] = [];

    for (const packId of dogfoodPackIds()) {
      vizTileBudgetRegistry.reset();
      syncVizTileScope(["dogfood"]);
      const contract = DEMO_PACK_CONTRACTS[packId];
      const budget = new VizFrameBudget(now, "dogfood");
      const writer = new VizBufferWriter(contract);
      const buildTimes: number[] = [];
      let prevVizClockMs = monoMs(0);
      let delivered = 0;
      let skippedStart = 0;
      const skipSamples: { t: number; n: number }[] = [];
      let presentT = 0;

      for (let i = 0; i < framesPerPack; i++) {
        const tickState = eventPeriodMs != null
          ? { ...baseState, ts: baseState.ts + (i * eventPeriodMs) / 1000 }
          : baseState;
        const tickT0 = now();
        const tick = dogfoodTick(packId, tickState, prevVizClockMs, audio, budget, writer);
        buildTimes.push(buildCostSample(buildCostOpt, i, now() - tickT0));
        if (tick.delivered && tick.frame) {
          delivered++;
          prevVizClockMs = monoMs(now());
        }
        if (presentStepMs != null) {
          presentT += presentStepMs;
          budget.markPresent(presentT);
        }
        const delta = budget.stats.skipped - skippedStart;
        if (delta > 0) {
          skipSamples.push({ t: now(), n: delta });
          skippedStart = budget.stats.skipped;
        }
        if (clockStepMs != null) {
          if (!simTimeMs) throw new Error("clockStepMs requires simTimeMs");
          simTimeMs.value += clockStepMs;
        }
      }

      const skipped = budget.stats.skipped;
      const p95 = percentile(buildTimes, 0.95);
      const presentP95 = presentStepMs != null ? presentStepMs : 0;
      const withinBudget = dogfoodWithinBudget(p95, presentP95, skipped);
      const lastHud = hudTickFromBudget(packId, packId, baseState, budget, now());
      const metric = vizHudMetric(packId, lastHud.frame, baseState);

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
      fixture: { devices: baseState.devices.length, flows: baseState.flows.length },
      budgetMs: VIZ_FRAME_BUDGET_MS,
      framesPerPack,
      packs,
      allWithinBudgetOrHonestSkips: packs.every((p) => p.withinBudget),
    };
  } finally {
    if (costInjector) setVizBuildCostInjector(undefined);
  }
}

/** Mid-run pack swap sequence: preserve vizFrameTs, skip counters, and UBO mirror. */
export function runPackSwapPreserve(
  state: StateMsg,
  fromPack: VizDemoPackId,
  toPack: VizDemoPackId,
  now: () => number = vizClockMs,
): {
  frameTs: number;
  skipped: number;
  uboMatch: boolean;
} {
  const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[fromPack]);
  writer.writeBuffer(0, [1, 2, 3, 4]);

  vizTileBudgetRegistry.reset();
  syncVizTileScope(["swap"]);
  const budget = new VizFrameBudget(now, "swap");
  let prevClock = monoMs(0);
  const tick1 = dogfoodTick(fromPack, state, prevClock, 0.1, budget, writer);
  prevClock = monoMs(now());

  dogfoodTick(fromPack, state, prevClock, 0.1, budget, writer);
  const uboBeforeSwap = writer.ubo.slice();

  const bound = hostBindOnPackSwap(
    writer,
    DEMO_PACK_CONTRACTS[toPack],
    0,
    budget,
    true,
  );
  const nextWriter = bound.writer!;
  const uboMatch = Array.from(nextWriter.ubo).every((v, i) => v === uboBeforeSwap[i]);

  dogfoodTick(toPack, state, prevClock, 0.1, budget, nextWriter);

  return {
    frameTs: tick1.frame?.t ?? 0,
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
