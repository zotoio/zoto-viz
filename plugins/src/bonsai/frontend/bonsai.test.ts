import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VIS from "../visualisation.yml?raw";
import PLUGIN from "../plugin.yml?raw";
import MAPPING from "../data-mapping.yml?raw";
import FRAG from "../sky/fragment.glsl?raw";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame, type VizTalkerSample } from "../../../sdk/viz-contract";
import { BONSAI_DATA_MAPPING, BONSAI_DEFAULTS, parseBonsaiOptions } from "./config";
import { BONSAI } from "./bonsai-data";
import {
  BS_BLOSSOM_SLOT0,
  BS_FALL_LOOK_SLOT,
  BS_FALL_SLOT,
  BS_MAX_BLOSSOMS,
  BS_PAD_SLOT,
  BS_SLOT,
  BS_SLOT_COUNT,
  blossomTintFor,
  bonsaiBlossomCount,
  bonsaiFailed,
  bonsaiFallingCount,
  bonsaiHudSkipCount,
  bonsaiPadCount,
  bonsaiPads,
  bonsaiSeason,
  bonsaiWorkBudget,
  dayPhaseFor,
  decodeBlossomLook,
  densityFor,
  disposeBonsaiPack,
  encodeBlossomLook,
  groundAt,
  ingestFrame,
  lightFor,
  packBonsaiSlots,
  parseBonsaiWorkBudgetYaml,
  setBonsaiClock,
  setBonsaiOptions,
} from "./bonsai";
import { SHIPPED_BONSAI_WORK_BUDGET } from "./work-budget";
import { pluginShaderError, probePluginSkyCompile, wrapPluginSky } from "./sky-probe";

const DT = 1 / 60;
const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix", "lego"];
const NOON = new Date(2026, 5, 1, 12, 0, 0);
const FAILED = { ...EMPTY_SYS_TELEMETRY, failed: 0.5 };

function frame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY }, ...over };
}

function talkers(n: number, rate = 20): VizTalkerSample[] {
  return Array.from({ length: n }, (_, i) => ({ id: `10.0.0.${i + 2}`, rate, role: "lan" }));
}

function run(frames: number, over: Partial<VizDataFrame> | ((f: number) => Partial<VizDataFrame>) = {}): Float32Array[] {
  let slots: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const o = typeof over === "function" ? over(f) : over;
    const fr = frame({ t: f * DT, ...o });
    ingestFrame(fr);
    slots = packBonsaiSlots(fr);
  }
  return slots;
}

/** Quiet traffic with a 0.5 s burst of 40 packets per frame every `every` seconds. */
function bursty(every: number, proto = "TCP"): (f: number) => Partial<VizDataFrame> {
  let frames = 0;
  return () => {
    const f = frames++;
    const t = f * DT;
    const inBurst = t % every < 0.5 && t > 2;
    const n = inBurst ? 40 : f % 30 === 0 ? 1 : 0;
    return { talkers: talkers(6), packets: Array.from({ length: n }, () => ({ proto, size: 600, field: 0.4 })) };
  };
}

/** What the host's loadPluginConfig sends: every visualisation.yml knob, untouched ones at their default. */
function hostFilledConfig(): Record<string, string> {
  const out: Record<string, string> = {};
  let key: string | null = null;
  for (const line of VIS.split("\n")) {
    const k = /^\s+- key: (\S+)/.exec(line);
    if (k) { key = k[1]!; continue; }
    const d = /^\s+default: "?([^"]*?)"?\s*$/.exec(line);
    if (key && d) { out[key] = d[1]!; key = null; }
  }
  return out;
}

type MotionListener = (e: { matches: boolean }) => void;

/** A prefers-reduced-motion MediaQueryList the test can flip; resets the pack so it re-reads it. */
function stubReducedMotionQuery(matches: boolean) {
  const listeners = new Set<MotionListener>();
  const mql = {
    matches,
    listeners,
    addEventListener: (_type: "change", fn: MotionListener) => { listeners.add(fn); },
    removeEventListener: (_type: "change", fn: MotionListener) => { listeners.delete(fn); },
    flip(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
  vi.stubGlobal("matchMedia", function (this: unknown, q: string) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return q === "(prefers-reduced-motion: reduce)" ? mql : { matches: false };
  });
  disposeBonsaiPack();
  return mql;
}

beforeEach(() => {
  disposeBonsaiPack();
  setBonsaiOptions(parseBonsaiOptions({}));
  setBonsaiClock(() => NOON);
});

describe("bonsai pack", () => {
  it("declares mapping, work budget, assets and the HD environment in yaml", () => {
    expect(VIS).toMatch(/dataMapping:/);
    expect(parseBonsaiWorkBudgetYaml(VIS)).toEqual(SHIPPED_BONSAI_WORK_BUDGET);
    expect(bonsaiWorkBudget()).toEqual(SHIPPED_BONSAI_WORK_BUDGET);
    for (const row of BONSAI_DATA_MAPPING) {
      expect(VIS).toContain(row.effect);
      expect(MAPPING).toContain(row.effect);
    }
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    expect(PLUGIN).toMatch(/maxBuffers: 6/);
    for (const id of ["bonsai-base", "bonsai-tree"]) {
      expect(PLUGIN).toContain(`path: assets/${id}.glb`);
      expect(PLUGIN).toContain(`path: assets/${id}-hd.glb`);
    }
    expect(PLUGIN).toMatch(/path: assets\/env-hd\.jpg\n\s+role: environment/);
    expect(VIS).toMatch(/key: modelSet/);
    expect(VIS).toMatch(/stageOnly: true/);
    expect(VIS).toMatch(/skyAudio: false/);
  });

  it("passes trademark name check on pack text", () => {
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}\n${MAPPING}`.toLowerCase();
    for (const mark of TRADEMARKS) expect(blob.includes(mark)).toBe(false);
  });

  it("wraps the sky shader with whitelisted uniforms only", () => {
    expect(pluginShaderError(FRAG)).toBeNull();
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
    // the fail chip and the bokeh are still: nothing in the shader moves with time
    expect(FRAG).not.toMatch(/uTime/);
  });

  it("clamps options from config.read strings only, inside the instance cap", () => {
    const o = parseBonsaiOptions({ preset: "zen", turnMinutes: "99", densityTalkers: "1", blossomCap: "99", fallCap: "40", failThreshold: "0", cameraMode: "spin", blossoms: "false", timeOfDay: "noon" });
    expect(o.preset).toBe("zen");
    expect(o.turnMinutes).toBe(20);
    expect(o.densityTalkers).toBe(2);
    expect(o.fallCap).toBe(16);
    expect(o.blossomCap).toBe(32);
    expect(o.failThreshold).toBe(0.05);
    expect(o.cameraMode).toBe("low");
    expect(o.blossoms).toBe(false);
    expect(o.timeOfDay).toBe("auto");
    expect(parseBonsaiOptions({ preset: "gallery" }).cameraMode).toBe("gallery");
    const tight = parseBonsaiOptions({ blossomCap: "32", fallCap: "16" }, 30);
    expect(tight.blossomCap + tight.fallCap).toBeLessThanOrEqual(30);
  });

  it("lets the preset win over knobs the host fills with their defaults", () => {
    const sent = hostFilledConfig();
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(Object.keys(BONSAI_DEFAULTS)));
    const zen = parseBonsaiOptions({ ...sent, preset: "zen" });
    expect([zen.turnMinutes, zen.blossomCap, zen.breeze, zen.cameraMode]).toEqual([8, 12, 0.25, "low"]);
    const spring = parseBonsaiOptions({ ...sent, preset: "spring" });
    expect([spring.blossomCap, spring.leafDensity, spring.breeze, spring.timeOfDay]).toEqual([32, 1.15, 0.7, "day"]);
    const gallery = parseBonsaiOptions({ ...sent, preset: "gallery" });
    expect([gallery.cameraMode, gallery.timeOfDay, gallery.turnMinutes]).toEqual(["gallery", "day", 3]);
    expect(parseBonsaiOptions({ ...sent, preset: "garden" })).toEqual(parseBonsaiOptions({}));
    // a knob moved off its default still beats the preset
    const mine = parseBonsaiOptions({ ...sent, preset: "zen", turnMinutes: "2", cameraMode: "close" });
    expect([mine.turnMinutes, mine.cameraMode, mine.breeze]).toEqual([2, "close", 0.25]);
  });

  it("leaf density follows active talkers on a log scale, slowly", () => {
    expect(densityFor(0, 12)).toBeCloseTo(0.3, 6);
    expect(densityFor(4, 12)).toBeGreaterThan(densityFor(1, 12));
    expect(densityFor(12, 12)).toBeCloseTo(1, 6);
    expect(densityFor(100, 12)).toBe(1);
    run(1200, { talkers: talkers(12) });
    const full = bonsaiSeason().density;
    expect(full).toBeGreaterThan(0.95);
    // idle talkers (rate under 0.05/s) do not count
    const slots = run(1, { talkers: [...talkers(1), ...talkers(10, 0.01).map((t, i) => ({ ...t, id: `x${i}` }))] });
    expect(slots[0]![BS_SLOT.talkers]).toBe(1);
    // one frame never jumps the canopy
    expect(full - bonsaiSeason().density).toBeLessThan(0.01);
    run(1800, { talkers: talkers(1) });
    expect(bonsaiSeason().density).toBeLessThan(0.65);
    const pres = slots[BS_PAD_SLOT]!;
    for (let k = 0; k < bonsaiPadCount(); k++) expect(pres[k * 2]!).toBeGreaterThan(0.2);
  });

  it("packet bursts open blossom clusters on a pad; steady traffic does not", () => {
    let max = 0;
    const feed = bursty(8);
    for (let s = 0; s < 40; s++) {
      run(60, feed);
      max = Math.max(max, bonsaiBlossomCount());
    }
    expect(max).toBeGreaterThanOrEqual(3);
    expect(max).toBeLessThanOrEqual(24);
    const slots = packBonsaiSlots(frame());
    const n = slots[0]![BS_SLOT.blossoms]!;
    for (let i = 0; i < n; i++) {
      const buf = slots[BS_BLOSSOM_SLOT0 + Math.floor(i / 16)]!;
      const o = (i % 16) * 4;
      const near = BONSAI.pads.some((p) => Math.hypot(buf[o]! - p.c[0], (buf[o + 1]! - p.c[1]) * 0.7, buf[o + 2]! - p.c[2]) < Math.max(...p.r) * 1.5);
      expect(near).toBe(true);
      const { tint, size } = decodeBlossomLook(buf[o + 3]!);
      expect(tint).toBe(blossomTintFor({ proto: "TCP" }));
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(1.25);
    }
    disposeBonsaiPack();
    run(3600, { talkers: talkers(6), packets: Array.from({ length: 3 }, () => ({ proto: "UDP", size: 500, field: 0.3 })) });
    // a steady 180 packets/s sets the baseline after the first seconds: no blossoms by the end
    expect(bonsaiBlossomCount()).toBe(0);
    expect(decodeBlossomLook(encodeBlossomLook(2, 0.9)).size).toBeCloseTo(0.9, 5);
    expect(BS_MAX_BLOSSOMS).toBe(32);
  });

  it("blossomCap and the frame packet budget hold under a flood", () => {
    setBonsaiOptions(parseBonsaiOptions({ blossomCap: "8" }));
    let max = 0;
    const feed = bursty(4, "UDP");
    for (let s = 0; s < 60; s++) {
      run(60, feed);
      max = Math.max(max, bonsaiBlossomCount());
    }
    expect(max).toBeLessThanOrEqual(8);
    expect(max).toBeGreaterThan(2);
    expect(bonsaiHudSkipCount()).toBeGreaterThan(0);
    setBonsaiOptions(parseBonsaiOptions({ blossoms: "false" }));
    run(10);
    expect(bonsaiBlossomCount()).toBe(0);
  });

  it("sys.failed turns the pads to autumn one by one, gently, and leaves fall to the slab", () => {
    run(600, { talkers: talkers(8) });
    let maxStep = 0;
    let maxFalling = 0;
    let spawned = 0;
    let lastFalling = 0;
    let staggered = false;
    let prev = Array.from(bonsaiPads().autumn);
    for (let f = 0; f < 60 * 60; f++) {
      run(1, { talkers: talkers(8), sys: FAILED });
      const a = bonsaiPads().autumn;
      for (let k = 0; k < bonsaiPadCount(); k++) maxStep = Math.max(maxStep, Math.abs(a[k]! - prev[k]!));
      prev = Array.from(a);
      const lo = Math.min(...prev.slice(0, bonsaiPadCount())), hi = Math.max(...prev.slice(0, bonsaiPadCount()));
      if (hi > 0.9 && lo < 0.1) staggered = true;
      const n = bonsaiFallingCount();
      if (n > lastFalling) spawned += n - lastFalling;
      lastFalling = n;
      maxFalling = Math.max(maxFalling, n);
    }
    expect(bonsaiFailed()).toBe(true);
    expect(bonsaiSeason().autumn).toBe(1);
    expect(staggered).toBe(true);
    // no flashing: a pad's colour moves by well under 1 % per frame
    expect(maxStep).toBeLessThan(0.01);
    expect(maxFalling).toBeGreaterThan(2);
    expect(maxFalling).toBeLessThanOrEqual(16);
    // at most one leaf per 0.8 s over the minute
    expect(spawned).toBeLessThanOrEqual(76);
    // shed pads thin, never empty
    for (let k = 0; k < bonsaiPadCount(); k++) expect(bonsaiPads().presence[k]!).toBeGreaterThan(0.2);
    const slots = packBonsaiSlots(frame());
    const nf = slots[0]![BS_SLOT.falling]!;
    let landed = 0;
    for (let i = 0; i < nf; i++) {
      const o = i * 4;
      const p = slots[BS_FALL_SLOT]!, k = slots[BS_FALL_LOOK_SLOT]!;
      const floor = groundAt(p[o]!, p[o + 2]!);
      expect(p[o + 1]!).toBeGreaterThanOrEqual(floor);
      expect(p[o + 1]!).toBeLessThan(0.6);
      expect(k[o]!).toBeGreaterThanOrEqual(0);
      expect(k[o]!).toBeLessThanOrEqual(2);
      if (k[o + 3] === 1) {
        landed++;
        expect(p[o + 1]!).toBeCloseTo(floor + 0.003, 4);
      }
    }
    expect(landed).toBeGreaterThan(0);
    // recovery: the tree greens again and the fallen leaves clear
    run(60 * 90, { talkers: talkers(8) });
    expect(bonsaiFailed()).toBe(false);
    expect(bonsaiSeason().autumn).toBe(0);
    expect(bonsaiFallingCount()).toBe(0);
  });

  it("holds the fail state steady while sys.failed flaps around the threshold", () => {
    run(600, { sys: FAILED });
    expect(bonsaiFailed()).toBe(true);
    let toggles = 0;
    let last = bonsaiFailed();
    for (let f = 0; f < 600; f++) {
      const slots = run(1, { sys: { ...EMPTY_SYS_TELEMETRY, failed: f % 20 < 10 ? 0.25 : 0.15 } });
      const on = slots[0]![BS_SLOT.failed] === 1;
      if (on !== last) toggles++;
      last = on;
    }
    expect(toggles).toBe(0);
  });

  it("time of day sets warmth and light: golden is warm, noon is bright, night is dark", () => {
    const noon = lightFor(0.5), golden = lightFor(0.71), night = lightFor(0.92), dawn = lightFor(0.29);
    expect(noon.sunElev).toBeCloseTo(1, 5);
    expect(golden.warmth).toBeGreaterThan(noon.warmth + 0.3);
    expect(dawn.warmth).toBeGreaterThan(noon.warmth + 0.3);
    expect(noon.light).toBeGreaterThan(golden.light);
    expect(night.light).toBeLessThan(golden.light);
    expect(night.night).toBeGreaterThan(0.9);
    expect(dayPhaseFor("auto", new Date(2026, 0, 1, 18, 0, 0))).toBeCloseTo(0.75, 6);
    expect(dayPhaseFor("golden", NOON)).toBe(0.71);
    setBonsaiOptions(parseBonsaiOptions({ timeOfDay: "golden" }));
    const g = Float32Array.from(run(600)[0]!);
    disposeBonsaiPack();
    setBonsaiClock(() => NOON);
    const d = Float32Array.from(run(600)[0]!);
    expect(g[BS_SLOT.warmth]!).toBeGreaterThan(d[BS_SLOT.warmth]! + 0.3);
    expect(d[BS_SLOT.dayPhase]!).toBeCloseTo(0.5, 5);
  });

  it("lands leaves on the slab, the board or the bench", () => {
    const foot = BONSAI.foot;
    expect(groundAt(foot[0] + 0.05, foot[2])).toBeGreaterThan(0.02);
    expect(groundAt(0.3, 0.12)).toBeGreaterThanOrEqual(0);
    expect(groundAt(0.6, 0)).toBe(BONSAI.board.bench);
    expect(groundAt(0, 0.4)).toBe(BONSAI.board.bench);
  });

  it("demo frames keep the tree alive: idle flag, demo talkers and blossoms", () => {
    let blossoms = 0;
    let slots: Float32Array[] = [];
    for (let s = 0; s < 30; s++) {
      slots = run(60, { demo: true });
      blossoms = Math.max(blossoms, bonsaiBlossomCount());
    }
    expect(slots[0]![BS_SLOT.idle]).toBe(1);
    expect(slots[0]![BS_SLOT.talkers]!).toBeGreaterThanOrEqual(3);
    expect(blossoms).toBeGreaterThanOrEqual(3);
  });

  it("packs slot geometry contract", () => {
    const slots = run(120, { talkers: talkers(6) });
    expect(slots).toHaveLength(BS_SLOT_COUNT);
    for (const s of slots) expect(s.length).toBe(64);
    const h = slots[0]!;
    expect(h[BS_SLOT.mark]).toBe(1);
    expect(h[BS_SLOT.fov]).toBeCloseTo(30, 3);
    expect(h[BS_SLOT.eyeZ]).toBeGreaterThan(1);
    expect(h[BS_SLOT.aimY]).toBeCloseTo(0.27, 3);
    const pads = slots[BS_PAD_SLOT]!;
    for (let k = bonsaiPadCount(); k < 16; k++) expect(pads[k * 2]).toBe(0);
    expect(bonsaiPadCount()).toBe(BONSAI.pads.length);
  });

  it("turns the board once per turnMinutes", () => {
    setBonsaiOptions(parseBonsaiOptions({ turnMinutes: "1" }));
    const a = run(60)[0]![BS_SLOT.yaw]!;
    const b = run(60 * 15)[0]![BS_SLOT.yaw]!;
    expect(b - a).toBeCloseTo(Math.PI / 2, 2);
  });

  it("is deterministic for the same frames", () => {
    const a = Array.from(run(1200, bursty(5))[BS_BLOSSOM_SLOT0]!);
    disposeBonsaiPack();
    setBonsaiClock(() => NOON);
    const b = Array.from(run(1200, bursty(5))[BS_BLOSSOM_SLOT0]!);
    expect(b).toEqual(a);
  });

  it("reduced motion holds the turntable and the camera still", () => {
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "on" }));
    const a = Array.from(run(60)[0]!.subarray(1, 9));
    const b = Array.from(run(1800)[0]!.subarray(1, 9));
    for (let i = 0; i < 8; i++) expect(b[i]).toBeCloseTo(a[i]!, 4);
    disposeBonsaiPack();
    setBonsaiOptions(parseBonsaiOptions({}));
    const c = run(60)[0]!;
    const yaw0 = c[BS_SLOT.yaw]!, x0 = c[BS_SLOT.eyeX]!;
    const d = run(1800)[0]!;
    expect(Math.abs(d[BS_SLOT.yaw]! - yaw0)).toBeGreaterThan(0.1);
    expect(Math.abs(d[BS_SLOT.eyeX]! - x0)).toBeGreaterThan(0.01);
  });
});

describe("bonsai reduced motion auto", () => {
  afterEach(() => {
    disposeBonsaiPack();
    vi.unstubAllGlobals();
  });

  const reducedSlot = (): number => run(2)[0]![BS_SLOT.reduced]!;

  it("follows the system setting and its live changes", () => {
    const mql = stubReducedMotionQuery(true);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "auto" }));
    expect(reducedSlot()).toBe(1);
    mql.flip(false);
    expect(reducedSlot()).toBe(0);
    mql.flip(true);
    expect(reducedSlot()).toBe(1);
  });

  it("lets explicit on and off beat the system setting", () => {
    stubReducedMotionQuery(true);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "off" }));
    expect(reducedSlot()).toBe(0);
    stubReducedMotionQuery(false);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "on" }));
    expect(reducedSlot()).toBe(1);
  });

  it("reads a sandbox without matchMedia as no preference", () => {
    vi.stubGlobal("matchMedia", undefined);
    disposeBonsaiPack();
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "auto" }));
    expect(reducedSlot()).toBe(0);
  });

  it("stops listening when the pack is disposed or leaves auto", () => {
    const mql = stubReducedMotionQuery(false);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "auto" }));
    expect(mql.listeners.size).toBe(1);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "off" }));
    expect(mql.listeners.size).toBe(0);
    setBonsaiOptions(parseBonsaiOptions({ reducedMotion: "auto" }));
    expect(mql.listeners.size).toBe(1);
    disposeBonsaiPack();
    expect(mql.listeners.size).toBe(0);
  });
});
