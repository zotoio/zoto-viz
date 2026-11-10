import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VIS from "../visualisation.yml?raw";
import PLUGIN from "../plugin.yml?raw";
import MAPPING from "../data-mapping.yml?raw";
import FRAG from "../sky/fragment.glsl?raw";
import KP_FIXTURE from "./fixtures/noaa-kp-headlines.json?raw";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame, type VizHeadline, type VizTalkerSample } from "../../../sdk/viz-contract";
import { FJORD_DATA_MAPPING, parseFjordOptions } from "./config";
import { FJORD } from "./fjord-data";
import {
  AF_CABIN,
  AF_CABIN_FLOATS,
  AF_CABIN_SLOT,
  AF_MAX_RIPPLES,
  AF_RIPPLE_SLOT,
  AF_SLOT,
  auroraFromKp,
  decodeRippleLook,
  demoKp,
  disposeFjordPack,
  encodeRippleLook,
  fjordCabins,
  fjordFailed,
  fjordFog,
  fjordHudSkipCount,
  fjordKp,
  fjordWorkBudget,
  ingestFrame,
  packFjordSlots,
  parseFjordWorkBudgetYaml,
  parseKpHeadlines,
  rippleHue,
  setFjordOptions,
  windowLevel,
  windowWarmth,
} from "./fjord";
import { SHIPPED_FJORD_WORK_BUDGET } from "./work-budget";
import { pluginShaderError, probePluginSkyCompile, wrapPluginSky } from "./sky-probe";

const DT = 1 / 60;
const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix", "lego"];
/** Recorded host projection of SWPC's planetary K-index (no network). */
const KP_HEADLINES: VizHeadline[] = JSON.parse(KP_FIXTURE).headlines;

function frame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY }, ...over };
}

const TALKERS: VizTalkerSample[] = [
  { id: "10.0.0.2", rate: 300, role: "self" },
  { id: "10.0.0.1", rate: 120, role: "gateway" },
  { id: "10.0.0.7", rate: 40, role: "lan" },
  { id: "1.1.1.1", rate: 12, role: "internet" },
  { id: "10.0.0.9", rate: 3, role: "lan" },
];

function run(frames: number, over: Partial<VizDataFrame> | ((f: number) => Partial<VizDataFrame>) = {}): Float32Array[] {
  let slots: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const o = typeof over === "function" ? over(f) : over;
    const fr = frame({ t: f * DT, ...o });
    ingestFrame(fr);
    slots = packFjordSlots(fr);
  }
  return slots;
}

const withKp = (kp: number): VizHeadline[] => [{ id: "noaa-kp:0", label: "NOAA planetary K-index", text: `Kp ${kp.toFixed(2)} · test` }];

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
  disposeFjordPack();
  return mql;
}

beforeEach(() => {
  disposeFjordPack();
  setFjordOptions(parseFjordOptions({}));
});

describe("aurora fjord pack", () => {
  it("declares mapping, work budget and both model sets in yaml", () => {
    expect(VIS).toMatch(/dataMapping:/);
    expect(parseFjordWorkBudgetYaml(VIS)).toEqual(SHIPPED_FJORD_WORK_BUDGET);
    expect(fjordWorkBudget()).toEqual(SHIPPED_FJORD_WORK_BUDGET);
    for (const row of FJORD_DATA_MAPPING) {
      expect(VIS).toContain(row.effect);
      expect(MAPPING).toContain(row.effect);
    }
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    for (const id of ["fjord-terrain", "fjord-shore"]) {
      expect(PLUGIN).toContain(`path: assets/${id}.glb`);
      expect(PLUGIN).toContain(`path: assets/${id}-hd.glb`);
    }
    expect(PLUGIN).toMatch(/path: assets\/env-hd\.jpg\n\s+role: environment/);
    expect(VIS).toMatch(/key: modelSet/);
    expect(VIS).toMatch(/stageOnly: true/);
    expect(VIS).toMatch(/key: source\n(?:.*\n){2}\s+default: noaa-kp/);
  });

  it("passes trademark name check on pack text", () => {
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}\n${MAPPING}`.toLowerCase();
    for (const mark of TRADEMARKS) expect(blob.includes(mark)).toBe(false);
  });

  it("wraps the sky shader with whitelisted uniforms only and keeps the chip steady", () => {
    expect(pluginShaderError(FRAG)).toBeNull();
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
    // motion comes from the slots; nothing in the shader modulates by uTime
    expect(FRAG).not.toMatch(/uTime/);
    // the march is bounded: 32 steps, 16 at low fps
    expect(FRAG).toMatch(/for \(int s = 0; s < 32; s\+\+\)/);
    expect(FRAG).toMatch(/gSteps = slot\(19\) > 0\.5 \? 16 : 32/);
  });

  it("clamps options from config.read strings only", () => {
    const o = parseFjordOptions({ preset: "substorm", cabinCap: "12", auroraGain: "9", rippleCap: "99", failThreshold: "0", cameraMode: "spin", ripples: "false", kpMode: "nope" });
    expect(o.preset).toBe("substorm");
    expect(o.cabinCap).toBe(8);
    expect(o.auroraGain).toBe(2);
    expect(o.rippleCap).toBe(16);
    expect(o.failThreshold).toBe(0.05);
    expect(o.cameraMode).toBe("high");
    expect(o.ripples).toBe(false);
    expect(o.kpMode).toBe("live");
    expect(parseFjordOptions({}).source).toBe("noaa-kp");
    expect(parseFjordOptions({ preset: "still-water" }).cameraMode).toBe("low");
    // streaks + ripples never exceed the instance cap
    const tight = parseFjordOptions({ cabinCap: "8" }, 14);
    expect(tight.cabinCap + tight.rippleCap).toBeLessThanOrEqual(14);
  });

  it("lets the preset win over knobs the host sends at their defaults", () => {
    const sent = { auroraGain: "1", auroraSpeed: "1", moon: "0.55", cameraMode: "drift", fogDensity: "0.8", rippleCap: "12" };
    const storm = parseFjordOptions({ ...sent, preset: "substorm" });
    expect([storm.auroraGain, storm.auroraSpeed, storm.moon, storm.cameraMode]).toEqual([1.35, 1.4, 0.3, "high"]);
    const fog = parseFjordOptions({ ...sent, preset: "sea-fog" });
    expect([fog.moon, fog.fogDensity, fog.auroraGain, fog.hazeFloor]).toEqual([0.75, 0.95, 0.85, 0.22]);
    expect(parseFjordOptions({ ...sent, preset: "still-water" }).rippleCap).toBe(8);
    // a knob moved off its default still beats the preset
    const mine = parseFjordOptions({ ...sent, preset: "substorm", auroraGain: "1.8", cameraMode: "low" });
    expect([mine.auroraGain, mine.cameraMode]).toEqual([1.8, "low"]);
  });

  it("reads Kp from the recorded noaa-kp headlines, newest first", () => {
    const r = parseKpHeadlines(KP_HEADLINES)!;
    expect(r.kp).toBeCloseTo(3, 5);
    expect(r.max24).toBeCloseTo(3, 5);
    expect(r.history).toHaveLength(8);
    expect(r.history[1]).toBeCloseTo(1.33, 5);
    // order on the wire does not matter, the id index does
    expect(parseKpHeadlines([...KP_HEADLINES].reverse())!.kp).toBeCloseTo(3, 5);
    // another source id still counts when it carries Kp; non-Kp headlines never do
    expect(parseKpHeadlines([{ id: "my-kp:0", label: "x", text: "Kp 5.33 · G1 storm" }])!.kp).toBeCloseTo(5.33, 5);
    expect(parseKpHeadlines([{ id: "hn:0", label: "HN", text: "Show HN: a Kp meter" }])).toBeNull();
    expect(parseKpHeadlines([{ id: "noaa-kp:0", label: "x", text: "Kp 42" }])).toBeNull();
    expect(parseKpHeadlines([])).toBeNull();
  });

  it("maps Kp to aurora strength, speed, latitude and storm, monotonic and clamped", () => {
    const q = auroraFromKp(0), m = auroraFromKp(3), s = auroraFromKp(7), x = auroraFromKp(99);
    expect(q.strength).toBeGreaterThan(0.05);
    expect(m.strength).toBeGreaterThan(q.strength);
    expect(s.strength).toBeGreaterThan(m.strength);
    expect(x.strength).toBeLessThanOrEqual(1);
    expect(s.speed).toBeGreaterThan(m.speed);
    expect(s.latitude).toBeGreaterThan(m.latitude);
    expect(x.latitude).toBe(1);
    expect(m.storm).toBe(0);
    expect(s.storm).toBeGreaterThan(0.5);
    expect(auroraFromKp(Number.NaN).strength).toBeCloseTo(q.strength, 6);
  });

  it("follows the source's Kp and eases a new reading in", () => {
    let slots = run(60, { headlines: KP_HEADLINES });
    expect(slots[0]![AF_SLOT.kpLive]).toBe(1);
    expect(slots[0]![AF_SLOT.kp]).toBeCloseTo(3, 4);
    const quiet = slots[0]![AF_SLOT.strength]!;
    expect(Array.from(slots[0]!.subarray(AF_SLOT.history, AF_SLOT.history + 8)).map((v) => Math.round(v * 100) / 100))
      .toEqual([2.67, 2, 3, 3, 2.33, 2.67, 1.33, 3]);
    slots = run(60, { headlines: withKp(7) });
    const mid = slots[0]![AF_SLOT.kp]!;
    expect(mid).toBeGreaterThan(3);
    expect(mid).toBeLessThan(5);
    slots = run(60 * 60, { headlines: withKp(7) });
    expect(slots[0]![AF_SLOT.kp]).toBeCloseTo(7, 2);
    expect(slots[0]![AF_SLOT.strength]).toBeGreaterThan(quiet);
    expect(slots[0]![AF_SLOT.storm]).toBeGreaterThan(0.5);
  });

  it("falls back to the golden idle Kp curve when the source is absent, and holds the last reading through a short gap", () => {
    let slots = run(120);
    expect(slots[0]![AF_SLOT.kpLive]).toBe(0);
    expect(slots[0]![AF_SLOT.kp]).toBeGreaterThan(0.3);
    expect(slots[0]![AF_SLOT.strength]).toBeGreaterThan(0.05);
    const curve = Array.from({ length: 600 }, (_, i) => demoKp(i));
    expect(Math.min(...curve)).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(...curve)).toBeGreaterThan(5);
    disposeFjordPack();
    run(60, { headlines: withKp(2) });
    slots = run(60 * 10);
    expect(slots[0]![AF_SLOT.kpLive]).toBe(1);
    slots = run(60 * 15);
    expect(slots[0]![AF_SLOT.kpLive]).toBe(0);
    // demo mode ignores the source
    disposeFjordPack();
    setFjordOptions(parseFjordOptions({ kpMode: "demo" }));
    expect(run(30, { headlines: KP_HEADLINES })[0]![AF_SLOT.kpLive]).toBe(0);
  });

  it("keeps talkers in their cabins through rate churn (2 s hold, 1.2x challenger)", () => {
    run(240, { talkers: TALKERS });
    const before = fjordCabins().slice(0, 5).map((c) => c.shown);
    expect(new Set(before).size).toBe(5);
    run(240, (f) => ({
      talkers: TALKERS.map((t, i) => (i >= 3 ? { ...t, rate: f % 2 ? 12 - i : 3 + i } : t)),
    }));
    expect(fjordCabins().slice(0, 5).map((c) => c.shown)).toEqual(before);
    const newcomer = { id: "10.0.0.50", rate: 900, role: "lan" };
    setFjordOptions(parseFjordOptions({ cabinCap: "5" }));
    run(30, { talkers: [...TALKERS, newcomer] });
    expect(fjordCabins().some((c) => c.shown === newcomer.id && c.fade > 0.9)).toBe(false);
    run(360, { talkers: [...TALKERS, newcomer] });
    expect(fjordCabins().slice(0, 5).some((c) => c.shown === newcomer.id)).toBe(true);
  });

  it("lights the busiest talker's window brightest, nearest cabin first", () => {
    const slots = run(300, { talkers: TALKERS });
    const cb = slots[AF_CABIN_SLOT]!;
    const light = (k: number) => cb[k * AF_CABIN_FLOATS + AF_CABIN.light]!;
    expect(light(0)).toBeGreaterThan(light(4));
    expect(light(4)).toBeGreaterThan(0.25);
    expect(light(5)).toBe(0);
    expect(slots[0]![AF_SLOT.cabins]).toBe(5);
    for (let k = 0; k < 8; k++) {
      expect(cb[k * AF_CABIN_FLOATS + AF_CABIN.shoreX]).toBeCloseTo(FJORD.cabins[k]!.shore[0], 3);
      expect(cb[k * AF_CABIN_FLOATS + AF_CABIN.present]).toBe(1);
    }
    expect(windowLevel(0)).toBeCloseTo(0.3, 6);
    expect(windowLevel(1e9)).toBeCloseTo(1, 6);
    expect(windowWarmth({ id: "x", role: "self" })).toBeLessThan(windowWarmth({ id: "x", role: "gateway" }));
    setFjordOptions(parseFjordOptions({ cabinCap: "3" }));
    const capped = run(300, { talkers: TALKERS })[AF_CABIN_SLOT]!;
    expect(capped[3 * AF_CABIN_FLOATS + AF_CABIN.present]).toBe(0);
    expect(capped[3 * AF_CABIN_FLOATS + AF_CABIN.light]).toBe(0);
  });

  it("packets ripple the water off lit cabins, capped by the pool and the frame budget", () => {
    setFjordOptions(parseFjordOptions({ rippleCap: "10" }));
    const packets = Array.from({ length: 20 }, (_, i) => ({ proto: i % 2 ? "UDP" : "TCP", size: 400 + i, field: 0.3 }));
    let maxRipples = 0;
    let flashed = 0;
    for (let f = 0; f < 600; f++) {
      const slots = run(1, { talkers: TALKERS, packets });
      const n = slots[0]![AF_SLOT.ripples]!;
      maxRipples = Math.max(maxRipples, n);
      for (let k = 0; k < 8; k++) flashed = Math.max(flashed, slots[AF_CABIN_SLOT]![k * AF_CABIN_FLOATS + AF_CABIN.flash]!);
      const rb = slots[AF_RIPPLE_SLOT]!;
      for (let i = 0; i < n; i++) {
        const [x, z, r, look] = [rb[i * 4]!, rb[i * 4 + 1]!, rb[i * 4 + 2]!, rb[i * 4 + 3]!];
        // on the water inside the fjord, off the lit (right-shore) cabins
        expect(Math.abs(x)).toBeLessThan(300);
        expect(z).toBeLessThan(-200);
        expect(z).toBeGreaterThan(-700);
        expect(r).toBeLessThanOrEqual(21);
        const { hue, intensity } = decodeRippleLook(look);
        expect(hue).toBeGreaterThan(0.06);
        expect(hue).toBeLessThan(0.45);
        expect(intensity).toBeGreaterThan(0.01);
      }
    }
    expect(maxRipples).toBeGreaterThan(4);
    expect(maxRipples).toBeLessThanOrEqual(10);
    expect(flashed).toBeGreaterThan(0.2);
    expect(fjordHudSkipCount()).toBeGreaterThan(0);
    expect(AF_MAX_RIPPLES).toBe(16);
    expect(decodeRippleLook(encodeRippleLook(0.1, 0.5)).intensity).toBeCloseTo(0.5, 5);
    expect(rippleHue({ proto: "TCP" })).toBe(rippleHue({ proto: "TCP" }));
    // many ripples roughen the water
    expect(run(1, { talkers: TALKERS, packets })[0]![AF_SLOT.calm]).toBeLessThan(0.9);
  });

  it("rolls a fog bank in on sys.failed and holds the chip steady while it flaps", () => {
    run(600);
    expect(fjordFog().level).toBeLessThan(0.01);
    const far = fjordFog().front;
    let slots = run(60 * 3, { sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.5 } });
    expect(fjordFailed()).toBe(true);
    const early = slots[0]![AF_SLOT.fog]!;
    slots = run(60 * 30, { sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.5 } });
    expect(slots[0]![AF_SLOT.fog]).toBeGreaterThan(early);
    expect(slots[0]![AF_SLOT.fog]).toBeGreaterThan(0.6);
    expect(slots[0]![AF_SLOT.fogFront]).toBeGreaterThan(far + 500);
    let toggles = 0;
    let last = fjordFailed();
    for (let f = 0; f < 600; f++) {
      const s = run(1, { sys: { ...EMPTY_SYS_TELEMETRY, failed: f % 20 < 10 ? 0.25 : 0.15 } });
      const on = s[0]![AF_SLOT.failed] === 1;
      if (on !== last) toggles++;
      last = on;
    }
    expect(toggles).toBe(0);
    slots = run(60 * 40);
    expect(fjordFailed()).toBe(false);
    expect(slots[0]![AF_SLOT.fog]).toBeLessThan(0.05);
  });

  it("demo frames never leave the shore dark", () => {
    const slots = run(300, { demo: true });
    expect(slots[0]![AF_SLOT.idle]).toBe(1);
    expect(slots[0]![AF_SLOT.cabins]).toBe(5);
    expect(fjordKp().live).toBe(false);
  });

  it("packs the slot contract the host scenery reads", () => {
    const slots = run(120, { talkers: TALKERS, headlines: KP_HEADLINES });
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(s.length).toBe(64);
    const h = slots[0]!;
    expect(h[AF_SLOT.mark]).toBe(1);
    expect(h[AF_SLOT.fov]).toBeCloseTo(34, 3);
    expect(h[AF_SLOT.eyeZ]).toBeCloseTo(40, 0);
    expect(h[AF_SLOT.aimZ]).toBeLessThan(-700);
    expect(h[AF_SLOT.gauge]).toBe(1);
    expect(h[AF_SLOT.hazeR + 2]).toBeGreaterThan(h[AF_SLOT.hazeR]!);
    expect(h[AF_SLOT.auroraR + 1]).toBeGreaterThan(h[AF_SLOT.auroraR]!);
    expect(h[AF_SLOT.fogFront]).toBeLessThan(-1000);
    expect(h[AF_SLOT.calm]).toBeGreaterThan(0.9);
    // the host indices this pack shares (web/src/graph/aurora-fjord-scenery.ts AF_SLOT)
    expect([AF_SLOT.strength, AF_SLOT.storm, AF_SLOT.fog, AF_SLOT.failed, AF_SLOT.lowFps, AF_SLOT.ripples, AF_SLOT.moon,
      AF_SLOT.fogFront, AF_SLOT.calm, AF_SLOT.hazeR, AF_SLOT.auroraR, AF_SLOT.time]).toEqual([9, 12, 13, 14, 19, 21, 22, 24, 25, 28, 31, 34]);
  });

  it("is deterministic for the same frames", () => {
    const over = { talkers: TALKERS, headlines: KP_HEADLINES, packets: [{ proto: "TCP", size: 600, field: 0.4 }] };
    const a = run(400, over).map((s) => Array.from(s));
    disposeFjordPack();
    const b = run(400, over).map((s) => Array.from(s));
    expect(b).toEqual(a);
  });

  it("reduced motion holds the camera still and slows the curtains", () => {
    setFjordOptions(parseFjordOptions({ reducedMotion: "on" }));
    const a = Array.from(run(60, { headlines: KP_HEADLINES })[0]!.subarray(1, 7));
    const slowSpeed = run(1, { headlines: KP_HEADLINES })[0]![AF_SLOT.speed]!;
    const b = Array.from(run(1800, { headlines: KP_HEADLINES })[0]!.subarray(1, 7));
    for (let i = 0; i < 6; i++) expect(b[i]).toBeCloseTo(a[i]!, 3);
    disposeFjordPack();
    const c = Array.from(run(60, { headlines: KP_HEADLINES })[0]!.subarray(1, 7));
    const fullSpeed = run(1, { headlines: KP_HEADLINES })[0]![AF_SLOT.speed]!;
    const d = Array.from(run(1800, { headlines: KP_HEADLINES })[0]!.subarray(1, 7));
    expect(Math.abs(d[3]! - c[3]!) + Math.abs(d[1]! - c[1]!)).toBeGreaterThan(0.1);
    expect(slowSpeed).toBeCloseTo(fullSpeed * 0.5, 5);
  });
});

describe("aurora fjord reduced motion auto", () => {
  afterEach(() => {
    disposeFjordPack();
    vi.unstubAllGlobals();
  });

  const reducedSlot = (): number => run(2)[0]![AF_SLOT.reduced]!;

  it("follows the system setting and its live changes", () => {
    const mql = stubReducedMotionQuery(true);
    setFjordOptions(parseFjordOptions({ reducedMotion: "auto" }));
    expect(reducedSlot()).toBe(1);
    mql.flip(false);
    expect(reducedSlot()).toBe(0);
    mql.flip(true);
    expect(reducedSlot()).toBe(1);
  });

  it("lets explicit on and off beat the system setting", () => {
    stubReducedMotionQuery(true);
    setFjordOptions(parseFjordOptions({ reducedMotion: "off" }));
    expect(reducedSlot()).toBe(0);
    stubReducedMotionQuery(false);
    setFjordOptions(parseFjordOptions({ reducedMotion: "on" }));
    expect(reducedSlot()).toBe(1);
  });

  it("reads a sandbox without matchMedia as no preference", () => {
    vi.stubGlobal("matchMedia", undefined);
    disposeFjordPack();
    setFjordOptions(parseFjordOptions({ reducedMotion: "auto" }));
    expect(reducedSlot()).toBe(0);
  });

  it("stops listening when the pack is disposed or leaves auto", () => {
    const mql = stubReducedMotionQuery(false);
    setFjordOptions(parseFjordOptions({ reducedMotion: "auto" }));
    expect(mql.listeners.size).toBe(1);
    setFjordOptions(parseFjordOptions({ reducedMotion: "off" }));
    expect(mql.listeners.size).toBe(0);
    setFjordOptions(parseFjordOptions({ reducedMotion: "auto" }));
    expect(mql.listeners.size).toBe(1);
    disposeFjordPack();
    expect(mql.listeners.size).toBe(0);
  });
});
