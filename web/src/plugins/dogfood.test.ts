import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetVizClockInjectors,
  setVizBuildCostTicksInjector,
  setVizClockInjector,
  setVizWallClockInjector,
} from "../core/viz-clock"
import { monoMs } from "../core/viz-time";
import { formatSkipRate, skipRatePerSec, VIZ_DEMO_PACKS, vizHudMetric } from "../ui/viz-hud";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  DEMO_PACK_CONTRACTS,
  dogfoodTick,
  dogfoodWithinBudget,
  hostBindOnPackSwap,
  hudTickFromBudget,
  DOGFOOD_SOAK_BUILD_COST_MS,
  DOGFOOD_SOAK_CLOCK_STEP_MS,
  DOGFOOD_SOAK_EVENT_PERIOD_MS,
  DOGFOOD_SOAK_FRAMES_PER_PACK,
  DOGFOOD_SOAK_PATTERN_EXPECTED,
  dogfoodSoakPatternedBuildCostMs,
  formatDogfoodCountGateReport,
  formatDogfoodReport,
  runDogfoodCountGate,
  runDogfoodSoak,
  runPackFrameHandler,
  runPackSwapPreserve,
} from "./dogfood-runner";
import { VIZ_FIXTURE_IDLE, VIZ_FIXTURE_GOLDEN_LIVE } from "../../../plugins/sdk/viz-fixtures";
import { packetTunnelFields } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import { packHnRainBuffer, packHnTermBuffer, packStereoDrive } from "./viz-pack-host";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import { TERM_COLS, TERM_ROWS } from "../../../plugins/src/hn-term/frontend/teletype";
import {
  easeStereoBins, parseStereoTiming, STEREO_BANDS, STEREO_BINS, STEREO_GAP, STEREO_RACKS,
  STEREO_RISE_MS, STEREO_SOLIDS, STEREO_HOLD, STEREO_MORPH, STEREO_MOTION_BANDS, STEREO_MOVE,
  STEREO_PALETTE_SECONDS, STEREO_REPEAT, STEREO_SPEED, STEREO_STILL,
} from "../../../plugins/src/stereo-gram/frontend/drive";
import {
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  VizFrameBudget,
  buildVizFrame,
  buildVizFrameForPlugin,
} from "./viz-host";
import type { StateMsg } from "../core/types";
import { syncVizTileScope, vizTileBudgetRegistry } from "./viz-tile-budget";

const FAT_LAN_SOAK_FRAMES = 120;
const FAT_LAN_SOAK_DEVICES = 420;
const FAT_LAN_SOAK_FLOWS = 1200;
const FAT_LAN_SOAK_CLOCK_START_MS = 1_767_225_600_000;
const FAT_LAN_SOAK_FAKE_STEP_MS = 0.05;
const FAT_LAN_SOAK_RANDOM_SEED = 0.25;
const FAT_LAN_SOAK_AUDIO = 0.15;
const FAT_LAN_SOAK_REAL_TIME_FORBIDDEN = "fat-LAN soak must not read real time";
const FAT_LAN_SPY_ROW_FRAME_T0 = 0;
const FAT_LAN_SPY_ROW_FRAME_STEP = 1 / 30;

function hnTermPackBufferCells(buf: number[]): string {
  const meta = 8;
  const n = TERM_COLS * TERM_ROWS;
  let cells = "";
  for (let i = 0; i < n; i++) {
    const code = Math.round(buf[meta + i]! * 95) + 32;
    cells += String.fromCharCode(code);
  }
  return cells;
}

function hnTermPackBufferTypedCharCount(buf: number[]): number {
  const cells = hnTermPackBufferCells(buf);
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells.charCodeAt(i) !== 32) count++;
  }
  return count;
}

/** Cells that were space in `before` and non-space in `after`. */
function hnTermPackBufferNewTypedCharCount(before: number[], after: number[]): number {
  const a = hnTermPackBufferCells(before);
  const b = hnTermPackBufferCells(after);
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if (a.charCodeAt(i) === 32 && b.charCodeAt(i) !== 32) count++;
  }
  return count;
}

type HnTermPackSession = {
  onFrame: (frame: VizDataFrame) => void;
  lastBuffer: () => number[];
};

async function createHnTermPackSession(): Promise<HnTermPackSession> {
  vi.resetModules();
  let captured: number[] = [];
  (globalThis as unknown as { zoto: VizZoto }).zoto = {
    onFrame: null,
    onConfig: null,
    onTick: null,
    getConfig: () => ({}),
    writeBuffer: (_slot, data) => {
      captured = Array.from(data);
    },
    writeUniform: () => {},
    writeParticles: () => {},
  };
  await import("../../../plugins/src/hn-term/frontend/index.ts");
  const onFrame = (globalThis as unknown as { zoto: VizZoto }).zoto.onFrame;
  if (!onFrame) throw new Error("hn-term pack did not register onFrame");
  return { onFrame, lastBuffer: () => captured };
}

/** Non-space glyph cells in the final hn-term pack buffer after 120 frames at `t = i/30`. */
const FAT_LAN_SPY_ROW_HN_TERM_TYPED_CHARS = 19;

const HN_TERM_DT_GUARD_SEGMENT_FRAMES = 60;
const HN_TERM_DT_GUARD_HOLD_FRAMES = 10;
const HN_TERM_DT_GUARD_FRAME_STEP = 1 / 30;

function tickHnTermPackFrames(
  session: HnTermPackSession,
  state: StateMsg,
  frames: number,
  tAt: (index: number) => number,
): void {
  const idle = DEMO_PACK_CONTRACTS["hn-term"].idle;
  for (let i = 0; i < frames; i++) {
    const frame = buildVizFrameForPlugin(state, 0, FAT_LAN_SOAK_AUDIO, idle);
    frame.t = tAt(i);
    session.onFrame(frame);
  }
}

/** 60× `i/30`, 10× hold, 60× `i/30` rewind on one pack session (no reset). */
const HN_TERM_DT_GUARD_TYPED_CHARS = 19;

/** After one `t = 1/30` warm-up frame, one `dt = 5` frame capped at 1. */
const HN_TERM_DT_CAP_STEP_TYPED_CHARS = 23;

/** After one `t = 1/30` warm-up frame, one `frame.t = Infinity` frame uses `1/60` fallback. */
const HN_TERM_DT_INFINITY_STEP_TYPED_CHARS = 1;

function hnTermDtGuardWarmOneThirtiethFrame(session: HnTermPackSession, state: StateMsg): void {
  tickHnTermPackFrames(session, state, 1, () => HN_TERM_DT_GUARD_FRAME_STEP);
}
function withFatLanSoakFakeTime<T>(run: (now: () => number) => T): T {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date(FAT_LAN_SOAK_CLOCK_START_MS));
  vi.spyOn(Math, "random").mockReturnValue(FAT_LAN_SOAK_RANDOM_SEED);
  const forbidRealTime = () => {
    throw new Error(FAT_LAN_SOAK_REAL_TIME_FORBIDDEN);
  };
  vi.spyOn(performance, "now").mockImplementation(forbidRealTime);
  vi.spyOn(Date, "now").mockImplementation(forbidRealTime);

  let fakeMs = 0;
  const fakeNow = () => {
    const t = fakeMs;
    fakeMs += FAT_LAN_SOAK_FAKE_STEP_MS;
    vi.advanceTimersByTime(FAT_LAN_SOAK_FAKE_STEP_MS);
    return t;
  };
  setVizClockInjector(() => fakeMs);
  setVizWallClockInjector(() => FAT_LAN_SOAK_CLOCK_START_MS + fakeMs);

  try {
    return run(fakeNow);
  } finally {
    resetVizClockInjectors();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

async function withFatLanSoakWallClockSpies<T>(
  run: (
    now: () => number,
    spies: { performanceNow: ReturnType<typeof vi.spyOn>; dateNow: ReturnType<typeof vi.spyOn> },
  ) => T | Promise<T>,
): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FAT_LAN_SOAK_CLOCK_START_MS));
  vi.spyOn(Math, "random").mockReturnValue(FAT_LAN_SOAK_RANDOM_SEED);
  const performanceNow = vi.spyOn(performance, "now");
  const dateNow = vi.spyOn(Date, "now");

  let fakeMs = 0;
  const fakeNow = () => {
    const t = fakeMs;
    fakeMs += FAT_LAN_SOAK_FAKE_STEP_MS;
    vi.advanceTimersByTime(FAT_LAN_SOAK_FAKE_STEP_MS);
    return t;
  };
  setVizClockInjector(() => fakeMs);
  setVizWallClockInjector(() => FAT_LAN_SOAK_CLOCK_START_MS + fakeMs);

  try {
    return await run(fakeNow, { performanceNow, dateNow });
  } finally {
    resetVizClockInjectors();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

const fatLanSoakState = fatLanFixture();

it("fat-LAN live soak: exact delivered counts on fake time", () => {
  const result = withFatLanSoakFakeTime((now) =>
    runDogfoodSoak({ state: fatLanSoakState, framesPerPack: FAT_LAN_SOAK_FRAMES, now }),
  );

  expect(result.framesPerPack).toBe(FAT_LAN_SOAK_FRAMES);
  expect(result.fixture.devices).toBe(FAT_LAN_SOAK_DEVICES);
  expect(result.fixture.flows).toBe(FAT_LAN_SOAK_FLOWS);
  expect(result.packs.map((p) => p.packId)).toEqual([...VIZ_DEMO_PACKS]);
  for (const pack of result.packs) {
    expect(pack.frames).toBe(FAT_LAN_SOAK_FRAMES);
    expect(pack.delivered).toBe(FAT_LAN_SOAK_FRAMES);
    expect(pack.skipped).toBe(0);
  }
});

it("hn-term frame.t backward step: dt guard uses 1/60 fallback", async () => {
  const session = await createHnTermPackSession();
  const state = fatLanFixture();
  const segment = () =>
    tickHnTermPackFrames(session, state, HN_TERM_DT_GUARD_SEGMENT_FRAMES, (i) => i * HN_TERM_DT_GUARD_FRAME_STEP);
  segment();
  const frozenAtHold = Array.from(session.lastBuffer());
  const holdT = (HN_TERM_DT_GUARD_SEGMENT_FRAMES - 1) * HN_TERM_DT_GUARD_FRAME_STEP;
  tickHnTermPackFrames(session, state, HN_TERM_DT_GUARD_HOLD_FRAMES, () => holdT);
  expect(hnTermPackBufferNewTypedCharCount(frozenAtHold, session.lastBuffer())).toBe(0);
  segment();
  expect(hnTermPackBufferTypedCharCount(session.lastBuffer())).toBe(HN_TERM_DT_GUARD_TYPED_CHARS);
});

it("hn-term frame.t cap step: dt above one adds capped typed characters", async () => {
  const session = await createHnTermPackSession();
  const state = fatLanFixture();
  hnTermDtGuardWarmOneThirtiethFrame(session, state);
  const frozen = Array.from(session.lastBuffer());
  const idle = DEMO_PACK_CONTRACTS["hn-term"].idle;
  const frame = buildVizFrameForPlugin(state, 0, FAT_LAN_SOAK_AUDIO, idle);
  frame.t = HN_TERM_DT_GUARD_FRAME_STEP + 5;
  session.onFrame(frame);
  expect(hnTermPackBufferNewTypedCharCount(frozen, session.lastBuffer())).toBe(HN_TERM_DT_CAP_STEP_TYPED_CHARS);
});

it("hn-term frame.t infinity step: non-finite dt uses 1/60 fallback", async () => {
  const session = await createHnTermPackSession();
  const state = fatLanFixture();
  hnTermDtGuardWarmOneThirtiethFrame(session, state);
  const frozen = Array.from(session.lastBuffer());
  const idle = DEMO_PACK_CONTRACTS["hn-term"].idle;
  const frame = buildVizFrameForPlugin(state, 0, FAT_LAN_SOAK_AUDIO, idle);
  frame.t = Infinity;
  session.onFrame(frame);
  expect(hnTermPackBufferNewTypedCharCount(frozen, session.lastBuffer())).toBe(HN_TERM_DT_INFINITY_STEP_TYPED_CHARS);
});

it("hn-term frame.t hold step: zero dt adds no typed characters", async () => {
  const session = await createHnTermPackSession();
  const state = fatLanFixture();
  tickHnTermPackFrames(session, state, HN_TERM_DT_GUARD_SEGMENT_FRAMES, (i) => i * HN_TERM_DT_GUARD_FRAME_STEP);
  let prev = Array.from(session.lastBuffer());
  const holdT = (HN_TERM_DT_GUARD_SEGMENT_FRAMES - 1) * HN_TERM_DT_GUARD_FRAME_STEP;
  const idle = DEMO_PACK_CONTRACTS["hn-term"].idle;
  for (let i = 0; i < HN_TERM_DT_GUARD_HOLD_FRAMES; i++) {
    const frame = buildVizFrameForPlugin(state, 0, FAT_LAN_SOAK_AUDIO, idle);
    frame.t = holdT;
    session.onFrame(frame);
    const cur = Array.from(session.lastBuffer());
    expect(hnTermPackBufferNewTypedCharCount(prev, cur)).toBe(0);
    prev = cur;
  }
  tickHnTermPackFrames(session, state, HN_TERM_DT_GUARD_SEGMENT_FRAMES, (i) => i * HN_TERM_DT_GUARD_FRAME_STEP);
  expect(hnTermPackBufferTypedCharCount(session.lastBuffer())).toBe(HN_TERM_DT_GUARD_TYPED_CHARS);
});

it("fat-LAN count gate: deterministic delivery and build work budgets", () => {
  setVizClockInjector(() => 0);
  setVizWallClockInjector(() => 0);
  const result = runDogfoodCountGate({ state: fatLanFixture(), framesPerPack: 120 });
  console.log("\n" + formatDogfoodCountGateReport(result));

  expect(result.fixture.devices).toBeGreaterThanOrEqual(300);
  expect(result.fixture.flows).toBeGreaterThanOrEqual(1000);
  expect(result.packs.length).toBeGreaterThanOrEqual(3);
  expect(result.packs.map((p) => p.packId)).toEqual(expect.arrayContaining([
    "packet-tunnel",
    "rf-constellation",
    "talker-storm",
    "kefrens-bars",
    "roto-proto",
    "blob-mesh",
    "star-sines",
    "hn-rain",
    "hn-term",
    "stereo-gram",
    "nixie-clock",
  ]));

  for (const pack of result.packs) {
    expect(pack.delivered).toBe(pack.frames);
    expect(pack.skipped).toBe(0);
  }
  expect(result.ok).toBe(true);
  resetVizClockInjectors();
});

it("fat-LAN live soak: termNow must not read wall clock", async () => {
  await withFatLanSoakWallClockSpies(async (_now, { performanceNow, dateNow }) => {
    const session = await createHnTermPackSession();
    performanceNow.mockClear();
    dateNow.mockClear();
    const state = fatLanFixture();
    const idle = DEMO_PACK_CONTRACTS["hn-term"].idle;
    for (let i = 0; i < FAT_LAN_SOAK_FRAMES; i++) {
      const frame = buildVizFrameForPlugin(state, 0, FAT_LAN_SOAK_AUDIO, idle);
      frame.t = FAT_LAN_SPY_ROW_FRAME_T0 + i * FAT_LAN_SPY_ROW_FRAME_STEP;
      session.onFrame(frame);
    }
    const buf = session.lastBuffer();
    expect(performanceNow).toHaveBeenCalledTimes(0);
    expect(dateNow).toHaveBeenCalledTimes(0);
    expect(hnTermPackBufferTypedCharCount(buf)).toBe(FAT_LAN_SPY_ROW_HN_TERM_TYPED_CHARS);
  });
});

describe("hn rain pack", () => {
  it("packs uppercase headline bytes the sky can decode", () => {
    const buf = packHnRainBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Jemalloc" }],
      0.2,
      0.1,
    );
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBeCloseTo(8 / 60);
    expect(buf.length).toBe(9 + 8);
    expect(Math.round(buf[9]! * 95) + 32).toBe("J".charCodeAt(0));
  });
});

describe("stereo gram pack", () => {
  it("packs traffic level, object, palette, burst and pattern settings into one slot", () => {
    const timing = {
      hold: 20, morph: 4, palette: "timer" as const, paletteSeconds: 45, still: 5, move: 1.5,
      repeat: 7, bands: 18, motionBands: 2.5, speed: 0.5, audio: true, shape: "oblong" as const, ai: true,
      spacing: 1,
      rack: parseStereoTiming().rack,
    };
    const bins = Array.from({ length: STEREO_BINS }, (_, i) => i / STEREO_BINS);
    const buf = packStereoDrive([{ rate: 100 }, { rate: 50 }], timing, { level: 0.4, clock: 1.5, bins });
    expect(buf).toHaveLength(32);
    expect(buf[0]).toBeCloseTo(1 - Math.exp(-1));
    expect(buf[1]).toBeCloseTo(0.25);
    expect(buf.slice(2, 11)).toEqual([20, 4, 1, 45, 5, 1.5, 7, 18, 2.5]);
    expect(buf[11]).toBeCloseTo(0.5);
    expect(buf[12]).toBe(1);
    expect(buf[13]).toBeCloseTo(0.4);
    expect(buf[14]).toBeCloseTo(1.5);
    expect(buf[15]).toBe(0);
    expect(buf.slice(16, 16 + STEREO_BINS)).toEqual(bins);
    expect(buf.slice(16 + STEREO_BINS)).toEqual(new Array(32 - 16 - STEREO_BINS).fill(0));
    const head = [1, 3, 0.5, 0.02, 0.1, -0.1, 0.3, 0];
    expect(packStereoDrive([], timing, { scene: head }).slice(24)).toEqual(head);
    expect(packStereoDrive([], timing, { scene: [1, 2] }).slice(24)).toEqual(new Array(8).fill(0));
    expect(packStereoDrive([], { ...timing, shape: "cubes" })[15]).toBe(1);
    expect(packStereoDrive([], { ...timing, shape: "balls" })[15]).toBe(2);
    expect(packStereoDrive([], { ...timing, shape: "morph" })[15]).toBe(3);
    expect(packStereoDrive([], { ...timing, palette: "objects", audio: false })[4]).toBe(0);
    expect(packStereoDrive([], { ...timing, audio: false })[12]).toBe(0);
  });

  it("eases bins like a meter: quick rise, slower fall", () => {
    const rise = STEREO_RISE_MS.def / 1000;
    const up = easeStereoBins([0], [1], rise)[0]!;
    expect(up).toBeCloseTo(1 - Math.exp(-1));
    const down = easeStereoBins([1], [0], rise)[0]!;
    expect(down).toBeGreaterThan(1 - up);
    expect(easeStereoBins([0.5], [0.2], 0)).toEqual([0.5]);
    expect(easeStereoBins([], [0.3, 0.6], 10)[1]).toBeCloseTo(0.6);
    expect(easeStereoBins([0], [1], 0.05, 0.05, 1)[0]).toBeCloseTo(1 - Math.exp(-1));
  });

  it("picks rack spacing from a preset or the custom sliders", () => {
    const a = parseStereoTiming().rack;
    expect(a).toEqual({
      preset: "c", ...STEREO_RACKS.c, growth: 1, depth: 0.4, origin: 0.25, ballGrow: "stretch", rise: 0.15, fall: 0.5,
    });
    expect(parseStereoTiming({ ballGrow: "swell" }).rack.ballGrow).toBe("swell");
    expect(parseStereoTiming({ rack: "a" }).rack).toMatchObject({ preset: "a", solids: 6, gap: 1.6 });
    expect(parseStereoTiming({ rack: "d", solids: "3", gap: "1" }).rack).toMatchObject({ preset: "d", ...STEREO_RACKS.d });
    expect(parseStereoTiming({ rack: "custom", solids: "9", gap: "0.1", width: "2" }).rack)
      .toMatchObject({ preset: "custom", solids: STEREO_SOLIDS.max, gap: STEREO_GAP.min, width: 2 });
    expect(parseStereoTiming({ rack: "zzz", origin: "-300", depth: "-5", rise: "1000" }).rack)
      .toMatchObject({ preset: "c", origin: -1, depth: 0, rise: 0.6 });
    expect(parseStereoTiming({ spacing: "999" }).spacing).toBe(2);
    expect(parseStereoTiming({ spacing: "10" }).spacing).toBe(0.5);
  });

  it("reads timing from view config, clamped, with defaults", () => {
    const defaults = {
      hold: STEREO_HOLD.def, morph: STEREO_MORPH.def, palette: "objects", paletteSeconds: STEREO_PALETTE_SECONDS.def,
      still: STEREO_STILL.def, move: STEREO_MOVE.def,
      repeat: STEREO_REPEAT.def, bands: STEREO_BANDS.def, motionBands: STEREO_MOTION_BANDS.def,
      speed: STEREO_SPEED.def / 100, audio: true, shape: "morph" as const, ai: true,
      spacing: 1,
      rack: parseStereoTiming().rack,
    };
    expect(parseStereoTiming()).toEqual(defaults);
    expect(parseStereoTiming({ hold: "", morph: "abc", palette: "rainbow" })).toEqual(defaults);
    expect(parseStereoTiming({
      hold: "30", morph: "5", palette: "timer", paletteSeconds: "60", still: "0", move: "3",
      repeat: "6", bands: "20.4", motionBands: "3",
    })).toEqual({
      hold: 30, morph: 5, palette: "timer", paletteSeconds: 60, still: 0, move: 3, repeat: 6, bands: 20, motionBands: 3,
      speed: 0.5, audio: true, shape: "morph", ai: true, spacing: 1, rack: parseStereoTiming().rack,
    });
    expect(parseStereoTiming({ ai: "false", shape: "balls" })).toMatchObject({ ai: false, shape: "balls" });
    expect(parseStereoTiming({ hold: "1", morph: "99", paletteSeconds: "1", move: "0" }))
      .toEqual({
        ...defaults, hold: STEREO_HOLD.min, morph: STEREO_MORPH.max, paletteSeconds: STEREO_PALETTE_SECONDS.min,
        move: STEREO_MOVE.min,
      });
  });
});

describe("hn term pack", () => {
  it("packs a typed screen the sky can decode", () => {
    const buf = packHnTermBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Jemalloc", summary: "A new allocator." }],
      20,
      0.2,
      1,
    );
    expect(buf[0]).toBe(14);
    expect(buf[1]).toBe(4);
    expect(buf.length).toBe(8 + 14 * 4);
    expect(buf.length).toBeLessThanOrEqual(64);
    expect(buf.slice(8).some((v) => Math.round(v * 95) + 32 === "J".charCodeAt(0))).toBe(true);
  });
});

describe("viz dogfood gates", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["dogfood"]);
  });

  afterEach(() => {
    resetVizClockInjectors();
    vi.restoreAllMocks();
  });

  const fatLan = fatLanFixture();

  it("over-budget tick bumps skip counter and withholds pack delivery", () => {
    const packId = "packet-tunnel";
    const contract = DEMO_PACK_CONTRACTS[packId];
    const writer = new VizBufferWriter(contract);
    const budget = new VizFrameBudget(() => 0, "t-over");
    setVizBuildCostTicksInjector((i) => (i < 2 ? (i === 0 ? 1200 : 15000) : 1200));

    const ok = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(ok.delivered).toBe(true);
    let prevClock = 0;
    const heavy = dogfoodTick(packId, fatLan, prevClock, 0.1, budget, writer);
    prevClock = 1000;
    expect(heavy.delivered).toBe(true);
    const skipped = dogfoodTick(packId, fatLan, prevClock, 0.1, budget, writer);
    expect(skipped.delivered).toBe(false);
    expect(skipped.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);
    setVizBuildCostTicksInjector(undefined);
  });

  it("packet-tunnel host idle yields non-zero buffer and bright on empty state", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = VIZ_FIXTURE_IDLE;
    expect(frame.packets.length).toBeGreaterThan(0);
    runPackFrameHandler("packet-tunnel", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => {
        writer.writeUniform(name, value);
        if (name === "uBright" && typeof value === "number") bright = value;
      },
      writeParticles: () => {},
    });
    const buf = Array.from(writer.snapshot(0));
    expect(buf[0]).toBeGreaterThan(0.25);
    expect(buf[1]).toBeGreaterThan(0.25);
    expect(bright).toBeGreaterThan(0.4);
  });

  it("talker-storm host idle yields particles on empty state", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["talker-storm"]);
    const frame = VIZ_FIXTURE_IDLE;
    expect(frame.talkers.length).toBeGreaterThan(0);
    runPackFrameHandler("talker-storm", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => { writer.writeUniform(name, value); },
      writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
    });
    expect(writer.particleSnapshot().length).toBeGreaterThan(0);
    expect(writer.snapshot(0)[0]).toBeGreaterThan(0);
  });

  it("packet-tunnel prefers live packets over host idle", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    let bright = 0;
    const frame = VIZ_FIXTURE_GOLDEN_LIVE;
    runPackFrameHandler("packet-tunnel", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => {
        writer.writeUniform(name, value);
        if (name === "uBright" && typeof value === "number") bright = value;
      },
      writeParticles: () => {},
    });
    const buf = Array.from(writer.snapshot(0));
    expect(buf[0]).toBeCloseTo(frame.packets[0]!.field);
    expect(buf[1]).toBeGreaterThan(0);
    expect(bright).toBeGreaterThan(0.4);
  });

  it("talker-storm pack handler refuses more than 512 particles", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["talker-storm"]);
    const frame = buildVizFrame(fatLan, monoMs(0), 0.1);
    const over: number[] = [];
    for (let i = 0; i < 513; i++) over.push(0, 0, 0, 1);
    const bad = writer.writeParticles(over, 4);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/512/);

    runPackFrameHandler("talker-storm", frame, {
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: (name, value) => { writer.writeUniform(name, value); },
      writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
    });
    expect(writer.particleSnapshot().length).toBeLessThanOrEqual(512 * 4);
  });

  it("preserve-frame across mid-run pack swap keeps vizFrameTs, skips, and UBO mirror", () => {
    setVizBuildCostTicksInjector((i) => (i === 1 || i === 3 ? 15000 : 1200));
    const times = [0, 4, 0, VIZ_FRAME_BUDGET_MS + 3, 0, 5, 0, 4];
    let tick = 0;
    const result = runPackSwapPreserve(
      fatLan,
      "packet-tunnel",
      "rf-constellation",
      () => times[tick++] ?? 999,
    );

    expect(result.frameTs).toBeGreaterThan(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.uboMatch).toBe(true);
    setVizBuildCostTicksInjector(undefined);

    const budget = new VizFrameBudget(() => 0, "swap");
    setVizBuildCostTicksInjector((i) => (i === 0 ? 1200 : 15000));
    budget.deliver(fatLan, monoMs(0), 0.1, () => {});
    budget.deliver(fatLan, monoMs(0), 0.1, () => {});
    expect(budget.stats.skipped).toBeGreaterThanOrEqual(1);
    setVizBuildCostTicksInjector(undefined);

    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    writer.writeBuffer(0, [9, 8, 7, 6]);
    const rebound = hostBindOnPackSwap(
      writer,
      DEMO_PACK_CONTRACTS["talker-storm"],
      result.frameTs,
      budget,
      true,
    );
    expect(rebound.frameTs).toBe(result.frameTs);
    expect(rebound.budget.stats.skipped).toBeGreaterThanOrEqual(1);
    expect(Array.from(rebound.writer!.ubo).slice(0, 4)).toEqual([9, 8, 7, 6]);
  });

  it("HUD metrics use only lastBuilt and stats — one buildVizFrame per tick", () => {
    const packId = "rf-constellation";
    const contract = DEMO_PACK_CONTRACTS[packId];
    const writer = new VizBufferWriter(contract);
    const budget = new VizFrameBudget();
    const buildSpy = vi.fn(buildVizFrame);
    const spy = { calls: 0 };

    const tick = dogfoodTick(packId, fatLan, 0, 0.2, budget, writer, spy, buildSpy);
    expect(spy.calls).toBe(1);
    expect(buildSpy).toHaveBeenCalledTimes(1);

    const hud = hudTickFromBudget(packId, "RF Constellation", fatLan, budget, 1000);
    const metric = vizHudMetric(packId, hud.frame, hud.state);
    expect(metric.label).toBe("RF");
    expect(hud.frame).toBe(budget.lastBuilt);
    expect(tick.lastBuilt).toBe(budget.lastBuilt);

    // Simulate HUD skip display from cumulative counter only
    const skipSamples = budget.stats.skipped > 0 ? [{ t: 1000, n: budget.stats.skipped }] : [];
    expect(formatSkipRate(skipRatePerSec(skipSamples, 1000))).toBe("skips 0/s");
  });

  it("fat-LAN live soak: count-based delivery and skip honesty on simulated clock", () => {
    const perfSpy = vi.spyOn(performance, "now");
    const dateSpy = vi.spyOn(Date, "now");
    const simTimeMs = { value: 0 };
    setVizClockInjector(() => simTimeMs.value);
    setVizWallClockInjector(() => simTimeMs.value + 1_000_000);
    perfSpy.mockClear();
    dateSpy.mockClear();

    const soakOpts = {
      state: fatLan,
      framesPerPack: DOGFOOD_SOAK_FRAMES_PER_PACK,
      buildCostMs: DOGFOOD_SOAK_BUILD_COST_MS,
      eventPeriodMs: DOGFOOD_SOAK_EVENT_PERIOD_MS,
      clockStepMs: DOGFOOD_SOAK_CLOCK_STEP_MS,
      simTimeMs,
      now: () => simTimeMs.value,
    };

    const expectedSkipped = 0;
    const expectedDelivered = DOGFOOD_SOAK_FRAMES_PER_PACK;
    const expectedSkipRate = 0;

    const result = runDogfoodSoak(soakOpts);

    expect(perfSpy).toHaveBeenCalledTimes(0);
    expect(dateSpy).toHaveBeenCalledTimes(0);

    console.log("\n" + formatDogfoodReport(result));

    expect(result.fixture.devices).toBeGreaterThanOrEqual(300);
    expect(result.fixture.flows).toBeGreaterThanOrEqual(1000);
    expect(result.packs.length).toBeGreaterThanOrEqual(3);
    expect(result.packs.map((p) => p.packId)).toEqual(expect.arrayContaining([
      "packet-tunnel",
      "rf-constellation",
      "talker-storm",
      "kefrens-bars",
      "roto-proto",
      "blob-mesh",
      "star-sines",
      "hn-rain",
      "hn-term",
      "stereo-gram",
      "nixie-clock",
    ]));

    for (const pack of result.packs) {
      expect(pack.delivered).toBe(expectedDelivered);
      expect(pack.skipped).toBe(expectedSkipped);
      expect(pack.skipRatePerSec).toBe(expectedSkipRate);
      expect(formatSkipRate(pack.skipRatePerSec)).toBe("skips 0/s");
    }
  });

  it("fat-LAN live soak: patterned over-budget skips on simulated clock", () => {
    const perfSpy = vi.spyOn(performance, "now");
    const dateSpy = vi.spyOn(Date, "now");
    const simTimeMs = { value: 0 };
    setVizClockInjector(() => simTimeMs.value);
    setVizWallClockInjector(() => simTimeMs.value + 1_000_000);
    perfSpy.mockClear();
    dateSpy.mockClear();

    const soakOpts = {
      state: fatLan,
      framesPerPack: DOGFOOD_SOAK_FRAMES_PER_PACK,
      buildCostMs: dogfoodSoakPatternedBuildCostMs,
      eventPeriodMs: DOGFOOD_SOAK_EVENT_PERIOD_MS,
      clockStepMs: DOGFOOD_SOAK_CLOCK_STEP_MS,
      simTimeMs,
      now: () => simTimeMs.value,
    };

    const result = runDogfoodSoak(soakOpts);

    expect(perfSpy).toHaveBeenCalledTimes(0);
    expect(dateSpy).toHaveBeenCalledTimes(0);

    for (const pack of result.packs) {
      expect(pack.delivered).toBe(DOGFOOD_SOAK_PATTERN_EXPECTED.delivered);
      expect(pack.skipped).toBe(DOGFOOD_SOAK_PATTERN_EXPECTED.skipped);
      expect(pack.skipRatePerSec).toBeGreaterThan(0);
      expect(formatSkipRate(pack.skipRatePerSec)).not.toBe("skips 0/s");
    }
  });
});

describe("viz dogfood over-budget honesty", () => {
  it("dogfood gate fails on soft-FPS when skips stay blank", () => {
    expect(dogfoodWithinBudget(5, 25, 0)).toBe(false);
    expect(dogfoodWithinBudget(5, 25, 3)).toBe(true);
    expect(dogfoodWithinBudget(20, 10, 0)).toBe(false);
  });

  it("records present-time skips when synthetic frame dt exceeds budget", () => {
    const fatLan = fatLanFixture();
    const result = runDogfoodSoak({
      state: fatLan,
      framesPerPack: 40,
      presentStepMs: 25,
    });

    for (const pack of result.packs) {
      expect(pack.skipped).toBeGreaterThan(0);
      expect(pack.withinBudget).toBe(true);
      expect(formatSkipRate(skipRatePerSec([{ t: 1000, n: pack.skipped }], 2000))).not.toBe("skips 0/s");
    }
    expect(result.allWithinBudgetOrHonestSkips).toBe(true);
  });

  it("empty StateMsg dogfood tick still delivers idle-backed frames", () => {
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS["packet-tunnel"]);
    const budget = new VizFrameBudget();
    const tick = dogfoodTick("packet-tunnel", emptyState(), 0, 0, budget, writer);
    expect(tick.delivered).toBe(true);
    expect(tick.frame?.packets.length).toBeGreaterThan(0);
    expect(writer.snapshot(0)[0]).toBeGreaterThan(0);
  });

  it("records skips when build is injected slow — never silent green", () => {
    const fatLan = fatLanFixture();
    const packId = "talker-storm";
    const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[packId]);
    vizTileBudgetRegistry.reset();
    syncVizTileScope(["slow"]);
    const budget = new VizFrameBudget(() => 0, "slow");
    setVizBuildCostTicksInjector((i) => (i < 2 ? (i === 0 ? 1200 : 15000) : 1200));

    const first = dogfoodTick(packId, fatLan, 0, 0.1, budget, writer);
    expect(first.delivered).toBe(true);

    const heavy = dogfoodTick(packId, fatLan, first.frame?.t ?? 0, 0.1, budget, writer);
    expect(heavy.delivered).toBe(true);
    const second = dogfoodTick(packId, fatLan, heavy.frame?.t ?? 0, 0.1, budget, writer);
    expect(second.delivered).toBe(false);
    setVizBuildCostTicksInjector(undefined);
    expect(second.lastBuilt).not.toBeNull();
    expect(budget.stats.skipped).toBe(1);

    const hud = hudTickFromBudget(packId, "Talker Storm", fatLan, budget, 2000);
    const samples = [{ t: 1900, n: 1 }];
    expect(formatSkipRate(skipRatePerSec(samples, 2000))).not.toBe("skips 0/s");
    expect(vizHudMetric(packId, hud.frame, hud.state).label).toBe("particles");
  });
});

function emptyState(): StateMsg {
  return {
    type: "state",
    ts: 10,
    iface: "",
    interfaces: [],
    network: "",
    local_ip: "",
    gateway: "",
    uptime: 0,
    stats: {
      pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
    },
    devices: [],
    flows: [],
  };
}
