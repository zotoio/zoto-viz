import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { VizDataFrame, VizSysTelemetry } from "../../../sdk/viz-contract";
import {
  RCS_CAPS,
  RCS_DEFAULTS,
  RCS_FIXED_DT,
  RCS_MAX_CARS,
  RCS_MAX_SUBSTEPS,
  RCS_MAX_TEAM,
  RCS_MAX_CAR_SPEED,
  RCS_GOAL_CELEBRATION_COOLDOWN_SEC,
  RCS_TALKER_SLOT_HOLD_SEC,
  RCS_MIN_DIRECTOR_CUT_SEC,
  RCS_PRESETS,
  RCS_SLOT,
  parseRcsOptions,
  presetConfigValues,
  rcsRenderScale,
  scanRcsTrademarks,
  validatePreset,
} from "./pack";
import {
  RCS_LIVE_MAPPING,
  RCS_PACKET_SLICE_CAP,
  hostLabelHash,
  ingestLiveFrame,
  resetRcsTalkerCacheForTest,
} from "./live";
import {
  enforceRcsCaps,
  maxSubstepsFor,
  rcsCarHostLabelHash,
  rcsEnterReplayForTest,
  rcsHostCarIndex,
  rcsLivePacketsConsumed,
  rcsMount,
  rcsObservedMaxCarSpeed,
  rcsOptionsNow,
  rcsPoolStats,
  rcsRunBoostSteps,
  rcsSampleAt,
  rcsSimAccumulator,
  rcsTestSkipKickoff,
  rcsFailDisplay,
  rcsLastCelebrationAt,
  rcsCarAssignedAt,
  rcsScoreNow,
  rcsTestPlaceBallForGoal,
  rcsTick,
  rcsTickParticlesBufferForTest,
  rcsTickSlotBuffersForTest,
  rcsTriggerMaxGoalExplosion,
  rcsUnmount,
  rcsWorkBudgetAtPreset,
  resetRcsSim,
  setRcsOptions,
} from "./match";
import { probePluginSkyCompile, wrapPluginSky } from "./test/sky-compile";

const PACK_DIR = join(__dirname, "..");
const FRAG = readFileSync(join(PACK_DIR, "sky/fragment.glsl"), "utf8");
const FRONT = readFileSync(join(PACK_DIR, "frontend/index.ts"), "utf8");
const VIS = readFileSync(join(PACK_DIR, "visualisation.yml"), "utf8");
const PLUGIN = readFileSync(join(PACK_DIR, "plugin.yml"), "utf8");
const README = readFileSync(join(PACK_DIR, "README.md"), "utf8");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ESBUILD_BIN = path.join(REPO_ROOT, "web/node_modules/.bin/esbuild");
const PACK_ENTRY = join(PACK_DIR, "frontend/index.ts");

const EMPTY_SYS: VizSysTelemetry = {
  cpu: 0,
  mem: 0,
  disk: 0,
  gpu: 0,
  temp: 0,
  watts: 0,
  psi: 0,
  sockets: 0,
  failed: 0,
  udev: 0,
};

const FORM_DEFAULTS: Record<string, string> = {
  preset: "broadcast",
  seed: "42",
  dice: "none",
  teamSize: "3",
  teamOrange: "#ff8c32",
  teamBlue: "#3aa7ff",
  theme: "day",
  aggress: "55",
  gameSpeed: "100",
  trail: "soft",
  camera: "director",
  minCutSec: "4",
  explode: "shockwave",
  replay: "true",
  matchSec: "300",
  ballSize: "100",
  particles: "70",
  reducedMotion: "false",
};

function vizFrame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return {
    t: 0,
    dt: 1 / 60,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
    ...over,
  };
}

function listPackFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listPackFiles(p));
    else out.push(p);
  }
  return out;
}

describe("rocket-car-soccer pack", () => {
  it("wraps and compiles the arena sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toMatch(/failA|sl\(0, 28/);
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("declares viz contract in plugin.yml and caps/mapping in pack source", () => {
    expect(PLUGIN).toMatch(/config\.read/);
    expect(PLUGIN).toMatch(/maxBuffers:\s*3/);
    expect(PLUGIN).toMatch(/maxBufferFloats:\s*64/);
    expect(PLUGIN).not.toMatch(/liveMapping:/);
    expect(RCS_CAPS).toEqual({
      maxCars: 6,
      maxTeam: 3,
      maxParticles: 48,
      maxTrailSegments: 24,
      maxPhysicsSubsteps: 4,
    });
    for (const row of RCS_LIVE_MAPPING) {
      expect(row.field.length).toBeGreaterThan(0);
      expect(row.effect.length).toBeGreaterThan(0);
    }
  });

  it("passes trademark name-check on all pack files", () => {
    const files = listPackFiles(PACK_DIR);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(scanRcsTrademarks(text), f).toBeNull();
    }
    expect(scanRcsTrademarks(README)).toBeNull();
    expect(scanRcsTrademarks(FRONT)).toBeNull();
  });

  it("validates every preset against option clamps", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      expect(validatePreset(id)).toBe(true);
      const merged = enforceRcsCaps(parseRcsOptions(presetConfigValues(id as keyof typeof RCS_PRESETS)));
      expect(merged.teamSize).toBeLessThanOrEqual(RCS_MAX_TEAM);
      expect(merged.particles).toBeLessThanOrEqual(100);
      expect(merged.minCutSec).toBeGreaterThanOrEqual(3);
    }
  });

  it("reads each shipped config key through parseRcsOptions", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain("minCutSec");
    expect(keys).not.toContain("cutHz");
    const base = JSON.stringify(parseRcsOptions({ preset: "neon_night" }));
    for (const key of keys) {
      if (key === "dice" || key === "preset" || key === "teamOrange" || key === "teamBlue") continue;
      const chunk = VIS.split(`key: ${key}`)[1]!.split("- key:")[0]!;
      const def = chunk.match(/default: (\S+)/)?.[1] ?? "";
      const min = Number(chunk.match(/min: (\S+)/)?.[1]);
      const max = Number(chunk.match(/max: (\S+)/)?.[1]);
      let flip = /true|false/.test(def) ? (def === "true" ? "false" : "true") : "17";
      if (Number.isFinite(min) && Number.isFinite(max)) {
        const d = Number(def);
        flip = String(Number.isFinite(d) && d > min ? min : max);
      }
      const selectVal = chunk.match(/-\s+\[(\w+),/);
      if (selectVal && selectVal[1] !== def) flip = selectVal[1]!;
      else if (selectVal) {
        const alt = [...chunk.matchAll(/-\s+\[(\w+),/g)].map((m) => m[1]!).find((v) => v !== def);
        if (alt) flip = alt;
      }
      if (FORM_DEFAULTS[key] === flip) continue;
      const parsed = parseRcsOptions({ preset: "neon_night", [key]: flip });
      const baseParsed = parseRcsOptions({ preset: "neon_night" });
      if (JSON.stringify(parsed) === JSON.stringify(baseParsed)) {
        const allAlts = [...chunk.matchAll(/-\s+\[(\w+),/g)].map((m) => m[1]!);
        const second = allAlts.find((v) => v !== (baseParsed as Record<string, unknown>)[key] && v !== flip);
        if (second && FORM_DEFAULTS[key] !== second) {
          expect(JSON.stringify(parseRcsOptions({ preset: "neon_night", [key]: second })), key).not.toBe(
            JSON.stringify(baseParsed),
          );
        }
        continue;
      }
      expect(JSON.stringify(parsed), key).not.toBe(JSON.stringify(baseParsed));
    }
  });

  it("enforces car, substep, and team caps", () => {
    setRcsOptions({ teamSize: "9", gameSpeed: "500", particles: "500" });
    const o = rcsOptionsNow();
    expect(o.teamSize).toBe(RCS_MAX_TEAM);
    expect(o.particles).toBeLessThanOrEqual(100);
    expect(maxSubstepsFor(1 / 30)).toBeLessThanOrEqual(RCS_MAX_SUBSTEPS);
    resetRcsSim(1);
    const packed = rcsTick(undefined, 1.6, 1 / 60, 1.777);
    expect(packed.slot0[RCS_SLOT.carCount]).toBeLessThanOrEqual(RCS_MAX_CARS);
    setRcsOptions({});
  });

  it("is deterministic for a fixed seed and time", () => {
    const a = rcsSampleAt(12.5, 0xdecaf);
    const b = rcsSampleAt(12.5, 0xdecaf);
    expect(a).toEqual(b);
  });

  it("does not re-run physics during replay sampling", () => {
    setRcsOptions({ replay: "true" });
    resetRcsSim(7);
    expect(() => rcsEnterReplayForTest()).not.toThrow();
  });

  it("keeps instanced pools at cap with no slot growth after warm-up", () => {
    resetRcsSim(1);
    rcsTriggerMaxGoalExplosion();
    for (let i = 0; i < 120; i++) rcsTick(undefined, i / 60, 1 / 60, 1.777);
    const stats = rcsPoolStats();
    expect(stats.particleAllocs).toBe(0);
    expect(stats.trailAllocs).toBe(0);
    const last = rcsTick(undefined, 2.5, 1 / 60, 1.777);
    expect(last.budget.particles).toBeLessThanOrEqual(RCS_CAPS.maxParticles);
    expect(last.budget.trailSegments).toBeLessThanOrEqual(RCS_CAPS.maxTrailSegments);
  });

  it("frees sandbox resources after 20 mount cycles", () => {
    for (let i = 0; i < 20; i++) {
      rcsMount();
      const mid = rcsUnmount();
      expect(mid.programs).toBeGreaterThan(0);
    }
    const clean = rcsUnmount();
    expect(clean.buffers).toBe(0);
    expect(clean.programs).toBe(0);
    expect(clean.contexts).toBe(0);
    expect(clean.raf).toBe(0);
    expect(clean.mounts).toBe(0);
  });

  it("work budget stays under plugin.yml caps at every preset", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      const b = rcsWorkBudgetAtPreset(id);
      expect(b.particles, id).toBeLessThanOrEqual(RCS_CAPS.maxParticles);
      expect(b.trailSegments, id).toBeLessThanOrEqual(RCS_CAPS.maxTrailSegments);
      expect(b.physicsSubsteps, id).toBeLessThanOrEqual(RCS_CAPS.maxPhysicsSubsteps);
    }
  });

  it("smoke-packs non-zero drive data (never an empty board)", () => {
    resetRcsSim(99);
    setRcsOptions({});
    const f = rcsTick(
      vizFrame({ demo: true, talkers: [{ id: "demo-host", rate: 12, role: "lan" }] }),
      1.0,
      1 / 60,
      1.777,
    );
    expect(f.slot0[RCS_SLOT.mark]).toBe(1);
    expect(f.slot0[RCS_SLOT.demoFlag]).toBe(1);
    const energy = [...f.slot0, ...f.slot1, ...f.slot2].reduce((s, v) => s + Math.abs(v), 0);
    expect(energy).toBeGreaterThan(10);
    const avg = energy / (f.slot0.length + f.slot1.length + f.slot2.length);
    expect(avg).toBeGreaterThan(0.05);
  });

  it("prioritises fail alert over goal flash in sim slots", () => {
    resetRcsSim(1);
    setRcsOptions({});
    let failAlert = 0;
    for (let i = 0; i < 40; i++) {
      const f = rcsTick(vizFrame({ sys: { ...EMPTY_SYS, failed: 1 } }), i / 60, 1 / 60, 1.777);
      failAlert = f.slot0[RCS_SLOT.failAlert]!;
    }
    expect(failAlert).toBeGreaterThan(0.5);
    rcsTriggerMaxGoalExplosion();
    const during = rcsTick(vizFrame({ sys: { ...EMPTY_SYS, failed: 1 } }), 0.6, 1 / 60, 1.777);
    expect(during.slot0[RCS_SLOT.goalFlash]).toBeLessThan(0.12);
  });

  it("keeps car slots keyed by talker id when talkers reorder", () => {
    resetRcsSim(1);
    resetRcsTalkerCacheForTest();
    const ha = hostLabelHash("10.0.0.10");
    const hb = hostLabelHash("10.0.0.20");
    rcsTick(
      vizFrame({
        talkers: [
          { id: "10.0.0.10", rate: 120, role: "lan" },
          { id: "10.0.0.20", rate: 5, role: "lan" },
        ],
      }),
      0,
      1 / 60,
      1.777,
    );
    const idxA = rcsHostCarIndex("10.0.0.10");
    const idxB = rcsHostCarIndex("10.0.0.20");
    expect(idxA).toBeDefined();
    expect(idxB).toBeDefined();
    expect(rcsCarHostLabelHash(idxA!)).toBeCloseTo(ha, 4);
    expect(rcsCarHostLabelHash(idxB!)).toBeCloseTo(hb, 4);
    let failGlobal = rcsTick(
      vizFrame({
        talkers: [
          { id: "10.0.0.20", rate: 5, role: "lan" },
          { id: "10.0.0.10", rate: 120, role: "lan" },
        ],
        sys: { ...EMPTY_SYS, failed: 0.85 },
      }),
      1 / 60,
      1 / 60,
      1.777,
    );
    expect(rcsHostCarIndex("10.0.0.10")).toBe(idxA);
    expect(rcsHostCarIndex("10.0.0.20")).toBe(idxB);
    expect(rcsCarHostLabelHash(idxA!)).toBeCloseTo(ha, 4);
    let failAlert = 0;
    for (let i = 0; i < 30; i++) {
      failGlobal = rcsTick(
        vizFrame({
          talkers: [
            { id: "10.0.0.20", rate: 5, role: "lan" },
            { id: "10.0.0.10", rate: 120, role: "lan" },
          ],
          sys: { ...EMPTY_SYS, failed: 0.85 },
        }),
        1 / 60 + i / 60,
        1 / 60,
        1.777,
      );
      failAlert = failGlobal.slot0[RCS_SLOT.failAlert]!;
    }
    expect(failAlert).toBeGreaterThan(0.5);
  });

  it("does not reassign a vacant talker slot to a new id immediately", () => {
    resetRcsSim(1);
    resetRcsTalkerCacheForTest();
    rcsTick(vizFrame({ talkers: [{ id: "host-aaa", rate: 40, role: "lan" }] }), 0, 1 / 60, 1.777);
    const slotA = rcsHostCarIndex("host-aaa");
    expect(slotA).toBeDefined();
    rcsTick(vizFrame({ talkers: [{ id: "host-bbb", rate: 40, role: "lan" }] }), 0.05, 1 / 60, 1.777);
    expect(rcsHostCarIndex("host-aaa")).toBeUndefined();
    expect(rcsHostCarIndex("host-bbb")).not.toBe(slotA);
  });

  it("never derives failure visuals from packet field or headlines", () => {
    resetRcsSim(1);
    const healthy = rcsTick(
      vizFrame({
        packets: [
          { proto: "tcp", size: 64, field: 0.02 },
          { proto: "udp", size: 32, field: 0.08 },
        ],
        sys: { ...EMPTY_SYS, failed: 0 },
        headlines: [{ id: "h1", label: "units", text: "3 failed services", kind: "alert" }],
      }),
      0,
      1 / 60,
      1.777,
    );
    expect(healthy.slot0[RCS_SLOT.failAlert]).toBe(0);
    const ingest = ingestLiveFrame(
      vizFrame({
        packets: [{ proto: "dns", size: 512, field: 0.99 }],
        sys: { ...EMPTY_SYS, failed: 0 },
        headlines: [{ id: "h2", label: "FAIL", text: "critical", kind: "fail" }],
      }),
    );
    expect(ingest.failAlert).toBe(0);
    expect(ingest.goalPulse).toBeGreaterThan(0.5);
  });

  it("aggregates packet goal pulse and consumes up to the host frame cap", () => {
    resetRcsTalkerCacheForTest();
    const live = ingestLiveFrame(
      vizFrame({
        talkers: [{ id: "talker-low", rate: 2, role: "lan" }],
        packets: [
          { proto: "tcp", size: 40, field: 0.05 },
          { proto: "tcp", size: 900, field: 0.92 },
        ],
      }),
    );
    expect(live.goalPulse).toBeGreaterThan(0.9);
    const many = Array.from({ length: 40 }, (_, i) => ({
      proto: "udp",
      size: 100 + i,
      field: 0.2,
    }));
    resetRcsSim(1);
    rcsTick(vizFrame({ packets: many }), 0, 1 / 60, 1.777);
    expect(rcsLivePacketsConsumed()).toBe(RCS_PACKET_SLICE_CAP);
  });

  it("rebuilds talker-derived maps only when talker id set changes", () => {
    resetRcsTalkerCacheForTest();
    const lowBoost = ingestLiveFrame(vizFrame({ talkers: [{ id: "10.0.0.1", rate: 10, role: "lan" }] })).perHostBoost.get(
      "10.0.0.1",
    )!;
    const highBoost = ingestLiveFrame(vizFrame({ talkers: [{ id: "10.0.0.1", rate: 45, role: "lan" }] })).perHostBoost.get(
      "10.0.0.1",
    )!;
    expect(highBoost).toBeGreaterThan(lowBoost);
    const swapped = ingestLiveFrame(vizFrame({ talkers: [{ id: "10.0.0.2", rate: 10, role: "gateway" }] }));
    expect(swapped.perHostBoost.has("10.0.0.1")).toBe(false);
    expect(swapped.perHostLabel.has("10.0.0.2")).toBe(true);
  });

  it("keeps render scale at 1.0 behind the swappable hook", () => {
    expect(rcsRenderScale()).toBe(1);
  });

  it("sandbox driver exports teardown hook for mount counting", () => {
    expect(FRONT).toMatch(/export function rcsFrontendTeardown/);
    expect(FRONT).toMatch(/rcsUnmount\s*\(/);
  });

  it("parses team colour overrides and seed", () => {
    const o = parseRcsOptions({ teamOrange: "#aabbcc", teamBlue: "#112233", seed: "1234" });
    expect(o.teamOrange).toBe("#aabbcc");
    expect(o.teamBlue).toBe("#112233");
    expect(o.seed).toBe(1234);
    expect(o.minCutSec).toBeGreaterThanOrEqual(RCS_MIN_DIRECTOR_CUT_SEC);
  });

  it("caps horizontal speed after sustained max boost", () => {
    resetRcsSim(1);
    const maxSpd = rcsRunBoostSteps(600);
    expect(maxSpd).toBeLessThanOrEqual(RCS_MAX_CAR_SPEED + 0.01);
    expect(maxSpd).toBeGreaterThan(10);
  });

  it("clamps physics accumulator after a long frame spike", () => {
    resetRcsSim(1);
    rcsTestSkipKickoff();
    const spike = rcsTick(vizFrame(), 1, 2, 1.777);
    expect(spike.budget.physicsSubsteps).toBeGreaterThan(RCS_MAX_SUBSTEPS);
    expect(rcsSimAccumulator()).toBeLessThanOrEqual(RCS_FIXED_DT + 1e-6);
    const normal = rcsTick(vizFrame(), 3, 1 / 60, 1.777);
    expect(normal.budget.physicsSubsteps).toBeLessThanOrEqual(RCS_MAX_SUBSTEPS);
  });

  it("applies preset values when host sends only form defaults", () => {
    const chill = parseRcsOptions({ preset: "chill_orbit" });
    expect(chill.teamSize).toBe(2);
    expect(chill.camera).toBe("orbit");
    expect(chill.theme).toBe("night");
    expect(chill.replay).toBe(false);
  });

  it("scores at most once per goal-line crossing burst", () => {
    resetRcsSim(1);
    rcsTestSkipKickoff();
    rcsTestPlaceBallForGoal(true);
    const before = rcsScoreNow()[1]!;
    for (let i = 0; i < 24; i++) rcsTick(undefined, i / 120, 1 / 120, 1.777);
    expect(rcsScoreNow()[1]).toBe(before + 1);
  });

  it("polls host config by reference in the sandbox driver", () => {
    expect(FRONT).toMatch(/pollHostConfig\s*\(/);
    expect(FRONT).toMatch(/cfg === lastCfgRef/);
    expect(FRONT).not.toMatch(/JSON\.stringify\(cfg\)/);
  });

  it("keeps a dense fixed-length particle buffer over 300 varying-count frames", () => {
    resetRcsSim(1);
    const buf = rcsTickParticlesBufferForTest();
    const cap = RCS_CAPS.maxParticles * 4;
    for (let i = 0; i < 300; i++) {
      if (i % 17 === 0) rcsTriggerMaxGoalExplosion();
      rcsTick(vizFrame({ demo: i % 5 === 0 }), i / 60, 1 / 60, 1.777);
      expect(buf.length).toBe(cap);
      for (let j = 0; j < cap; j++) {
        expect(j in buf).toBe(true);
      }
    }
  });

  it("reuses tick slot buffer instances across 300 frames", () => {
    resetRcsSim(1);
    const a = rcsTickSlotBuffersForTest();
    for (let i = 0; i < 300; i++) {
      rcsTick(vizFrame({ demo: true }), i / 60, 1 / 60, 1.777);
    }
    const b = rcsTickSlotBuffersForTest();
    expect(b.slot0).toBe(a.slot0);
    expect(b.slot1).toBe(a.slot1);
    expect(b.slot2).toBe(a.slot2);
  });

  it("rate-limits packet goal celebrations to once per 3 seconds", () => {
    resetRcsSim(1);
    rcsTestSkipKickoff();
    setRcsOptions({});
    const hiPkt = vizFrame({ packets: [{ proto: "tcp", size: 900, field: 0.95 }] });
    for (let i = 0; i < 90; i++) rcsTick(hiPkt, i / 60, 1 / 60, 1.777);
    const t0 = rcsLastCelebrationAt();
    expect(t0).toBeGreaterThan(-900);
    for (let i = 0; i < 30; i++) rcsTick(hiPkt, 1 + i / 60, 1 / 60, 1.777);
    expect(rcsLastCelebrationAt()).toBe(t0);
    for (let i = 0; i < 120; i++) rcsTick(hiPkt, 3.5 + i / 60, 1 / 60, 1.777);
    expect(rcsLastCelebrationAt()).toBeGreaterThan(t0);
  });

  it("assigns a new talker to a free car immediately", () => {
    resetRcsSim(1);
    resetRcsTalkerCacheForTest();
    setRcsOptions({ teamSize: "2" });
    rcsTick(vizFrame({ talkers: [{ id: "a", rate: 10, role: "lan" }] }), 0, 1 / 60, 1.777);
    const slotA = rcsHostCarIndex("a");
    rcsTick(vizFrame({ talkers: [{ id: "b", rate: 20, role: "lan" }] }), 0.02, 1 / 60, 1.777);
    const slotB = rcsHostCarIndex("b");
    expect(slotB).toBeDefined();
    expect(slotB).not.toBe(slotA);
  });

  it("holds departed talker slot for 2s and requires 1.2x rate to challenge", () => {
    resetRcsSim(1);
    resetRcsTalkerCacheForTest();
    setRcsOptions({ teamSize: "2" });
    rcsTick(
      vizFrame({
        talkers: [
          { id: "low-1", rate: 50, role: "lan" },
          { id: "low-2", rate: 50, role: "lan" },
        ],
      }),
      0,
      1 / 60,
      1.777,
    );
    const slot1 = rcsHostCarIndex("low-1")!;
    rcsTick(vizFrame({ talkers: [{ id: "low-2", rate: 50, role: "lan" }] }), 0.1, 1 / 60, 1.777);
    rcsTick(vizFrame({ talkers: [{ id: "low-2", rate: 50, role: "lan" }, { id: "challenger", rate: 55, role: "lan" }] }), 0.2, 1 / 60, 1.777);
    const chSlot = rcsHostCarIndex("challenger");
    expect(chSlot).toBeDefined();
    expect(chSlot).not.toBe(slot1);
    rcsTick(
      vizFrame({
        talkers: [
          { id: "t1", rate: 40, role: "lan" },
          { id: "t2", rate: 40, role: "lan" },
          { id: "t3", rate: 40, role: "lan" },
          { id: "t4", rate: 40, role: "lan" },
        ],
      }),
      3,
      1 / 60,
      1.777,
    );
    for (let i = 0; i < 4; i++) expect(rcsCarAssignedAt(i)).toBeGreaterThanOrEqual(0);
    rcsTick(vizFrame({ talkers: [{ id: "t1", rate: 40, role: "lan" }, { id: "t2", rate: 40, role: "lan" }, { id: "t3", rate: 40, role: "lan" }, { id: "t4", rate: 40, role: "lan" }, { id: "boss", rate: 100, role: "lan" }] }), 5.5, 1 / 60, 1.777);
    expect(rcsHostCarIndex("boss")).toBeDefined();
  });

  it("smooths stadium fail display without strobing while sys.failed stays high", () => {
    resetRcsSim(1);
    const f1 = rcsTick(vizFrame({ sys: { ...EMPTY_SYS, failed: 1 } }), 0, 1 / 60, 1.777);
    const f2 = rcsTick(vizFrame({ sys: { ...EMPTY_SYS, failed: 1 } }), 0.5, 1 / 60, 1.777);
    const f3 = rcsTick(vizFrame({ sys: { ...EMPTY_SYS, failed: 1 } }), 1.0, 1 / 60, 1.777);
    expect(f2.slot0[RCS_SLOT.failAlert]!).toBeGreaterThanOrEqual(f1.slot0[RCS_SLOT.failAlert]!);
    expect(f3.slot0[RCS_SLOT.failAlert]!).toBeGreaterThanOrEqual(f2.slot0[RCS_SLOT.failAlert]!);
    expect(Math.abs(f3.slot0[RCS_SLOT.failAlert]! - f2.slot0[RCS_SLOT.failAlert]!)).toBeLessThan(0.2);
  });

  it("documents UX legend and tile readability in the sky shader", () => {
    expect(FRAG).toMatch(/chipOn|zotoFail|demoOn/);
    expect(FRAG).toMatch(/1\.18 \* ballS/);
    expect(FRAG).toMatch(/drawMmSs/);
  });

  it("writes viz buffers from the sandbox driver", () => {
    expect(FRONT).toMatch(/writeBuffer\s*\(/);
    expect(FRONT).toMatch(/writeParticles\s*\(/);
  });

  it("each preset exports stable config strings", () => {
    for (const id of Object.keys(RCS_PRESETS)) {
      expect(validatePreset(id)).toBe(true);
      const cfg = presetConfigValues(id as keyof typeof RCS_PRESETS);
      expect(cfg.preset).toBe(id);
      expect(parseRcsOptions(cfg).teamSize).toBeGreaterThanOrEqual(2);
    }
  });

  it.skipIf(!existsSync(ESBUILD_BIN))(
    "esbuild bundles the pack entry (type-only viz-contract)",
    () => {
      const js = execFileSync(
        ESBUILD_BIN,
        [
          PACK_ENTRY,
          "--bundle",
          "--format=esm",
          "--platform=browser",
          "--target=es2022",
          "--external:three",
          "--external:d3-force-3d",
        ],
        { encoding: "utf8" },
      );
      expect(js.length).toBeGreaterThan(32);
      expect(js).not.toMatch(/viz-contract/);
    },
  );

  const hostFormDefaults = (): Record<string, string> => ({
    preset: "broadcast",
    seed: "42",
    dice: "none",
    teamSize: "3",
    theme: "day",
    camera: "director",
    aggress: "55",
    gameSpeed: "100",
    trail: "soft",
    minCutSec: "4",
    explode: "shockwave",
    replay: "true",
    matchSec: "300",
    ballSize: "100",
    particles: "70",
    reducedMotion: "false",
    teamOrange: "#ff8c32",
    teamBlue: "#3aa7ff",
  });

  it("does not JSON.stringify config on unchanged 300 onFrame polls", async () => {
    vi.resetModules();
    const hostCfg = hostFormDefaults();
    const g = globalThis as unknown as {
      zoto: {
        onFrame: ((frame: VizDataFrame) => void) | null;
        onConfig: ((cfg: Record<string, string>) => void) | null;
        getConfig?: () => Record<string, string>;
        writeBuffer: (slot: number, data: number[]) => void;
        writeUniform: (name: string, value: number | [number, number, number]) => void;
        writeParticles: (data: number[], stride?: number) => void;
      };
    };
    g.zoto = {
      onFrame: null,
      onConfig: null,
      getConfig: () => hostCfg,
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const stringifySpy = vi.spyOn(JSON, "stringify");
    await import("./index");
    stringifySpy.mockClear();
    for (let i = 0; i < 300; i++) {
      g.zoto.onFrame!({
        t: i / 60,
        dt: 1 / 60,
        audio: 0,
        packets: [],
        rf: [],
        talkers: [],
        headlines: [],
        demo: true,
      });
    }
    expect(stringifySpy).toHaveBeenCalledTimes(0);
    stringifySpy.mockRestore();
  });

  it("randomise does not mutate the host config object", async () => {
    vi.resetModules();
    const hostCfg = hostFormDefaults();
    const g = globalThis as unknown as {
      zoto: {
        onFrame: ((frame: VizDataFrame) => void) | null;
        onConfig: ((cfg: Record<string, string>) => void) | null;
        getConfig?: () => Record<string, string>;
        writeBuffer: (slot: number, data: number[]) => void;
        writeUniform: (name: string, value: number | [number, number, number]) => void;
        writeParticles: (data: number[], stride?: number) => void;
      };
    };
    g.zoto = {
      onFrame: null,
      onConfig: null,
      getConfig: () => hostCfg,
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const mod = await import("./index");
    mod.rcsTestResetDriverStateForTest();
    const snap = { ...hostCfg, teamSize: "3", camera: "director" };
    hostCfg.dice = "randomise";
    g.zoto.onConfig!(hostCfg);
    expect(hostCfg.teamSize).toBe(snap.teamSize);
    expect(hostCfg.camera).toBe(snap.camera);
    expect(hostCfg.trail).toBe(snap.trail);
  });

  it("randomise pushes one undo and undo restores prior options", async () => {
    vi.resetModules();
    const hostCfg = hostFormDefaults();
    const g = globalThis as unknown as {
      zoto: {
        onFrame: ((frame: VizDataFrame) => void) | null;
        onConfig: ((cfg: Record<string, string>) => void) | null;
        getConfig?: () => Record<string, string>;
        writeBuffer: (slot: number, data: number[]) => void;
        writeUniform: (name: string, value: number | [number, number, number]) => void;
        writeParticles: (data: number[], stride?: number) => void;
      };
    };
    g.zoto = {
      onFrame: null,
      onConfig: null,
      getConfig: () => hostCfg,
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const mod = await import("./index");
    mod.rcsTestResetDriverStateForTest();
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg });
    const before = { ...mod.rcsFrontendOptionsForTest() };
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "randomise" });
    expect(mod.rcsFrontendUndoDepthForTest()).toBe(1);
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "undo" });
    expect(mod.rcsFrontendUndoDepthForTest()).toBe(0);
    expect(mod.rcsFrontendOptionsForTest()).toEqual(before);
  });

  it("records three undo steps for three randomise clicks and walks back two undos", async () => {
    vi.resetModules();
    const hostCfg = hostFormDefaults();
    const g = globalThis as unknown as {
      zoto: {
        onFrame: ((frame: VizDataFrame) => void) | null;
        onConfig: ((cfg: Record<string, string>) => void) | null;
        getConfig?: () => Record<string, string>;
        writeBuffer: (slot: number, data: number[]) => void;
        writeUniform: (name: string, value: number | [number, number, number]) => void;
        writeParticles: (data: number[], stride?: number) => void;
      };
    };
    g.zoto = {
      onFrame: null,
      onConfig: null,
      getConfig: () => hostCfg,
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const mod = await import("./index");
    mod.rcsTestResetDriverStateForTest();
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg });
    const snap0 = { ...mod.rcsFrontendOptionsForTest() };
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "randomise" });
    const snap1 = { ...mod.rcsFrontendOptionsForTest() };
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "randomise" });
    const snap2 = { ...mod.rcsFrontendOptionsForTest() };
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "randomise" });
    expect(mod.rcsFrontendUndoDepthForTest()).toBe(3);
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "undo" });
    expect(mod.rcsFrontendOptionsForTest()).toEqual(snap2);
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "undo" });
    expect(mod.rcsFrontendOptionsForTest()).toEqual(snap1);
    expect(mod.rcsFrontendUndoDepthForTest()).toBe(1);
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "undo" });
    expect(mod.rcsFrontendOptionsForTest()).toEqual(snap0);
  });

  it("keeps randomised look when host later changes an unrelated slider field", async () => {
    vi.resetModules();
    const hostCfg = hostFormDefaults();
    const g = globalThis as unknown as {
      zoto: {
        onFrame: ((frame: VizDataFrame) => void) | null;
        onConfig: ((cfg: Record<string, string>) => void) | null;
        getConfig?: () => Record<string, string>;
        writeBuffer: (slot: number, data: number[]) => void;
        writeUniform: (name: string, value: number | [number, number, number]) => void;
        writeParticles: (data: number[], stride?: number) => void;
      };
    };
    g.zoto = {
      onFrame: null,
      onConfig: null,
      getConfig: () => hostCfg,
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
    };
    const mod = await import("./index");
    mod.rcsTestResetDriverStateForTest();
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg });
    mod.rcsTestApplyHostConfigForTest({ ...hostCfg, dice: "randomise" });
    const afterRand = { ...mod.rcsFrontendOptionsForTest() };
    hostCfg.aggress = "22";
    g.zoto.onFrame!(vizFrame());
    expect(mod.rcsFrontendOptionsForTest().aggress).toBe(22);
    expect(mod.rcsFrontendOptionsForTest().theme).toBe(afterRand.theme);
    expect(mod.rcsFrontendOptionsForTest().camera).toBe(afterRand.camera);
    expect(mod.rcsFrontendOptionsForTest().trail).toBe(afterRand.trail);
    expect(mod.rcsFrontendOptionsForTest().gameSpeed).toBe(afterRand.gameSpeed);
  });
});
