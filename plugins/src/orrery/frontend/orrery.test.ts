import { beforeEach, describe, expect, it } from "vitest";
import VIS from "../visualisation.yml?raw";
import PLUGIN from "../plugin.yml?raw";
import MAPPING from "../data-mapping.yml?raw";
import FRAG from "../sky/fragment.glsl?raw";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame, type VizTalkerSample } from "../../../sdk/viz-contract";
import { ORRERY_DATA_MAPPING, parseOrreryOptions } from "./config";
import { ORRERY } from "./orrery-data";
import {
  OR_ARM,
  OR_ARM_FLOATS,
  OR_ARM_SLOT,
  OR_MAX_SPARKS,
  OR_SLOT,
  OR_SPARK_SLOT0,
  BEAT_S,
  beatLength,
  decodeSparkLook,
  disposeOrreryPack,
  encodeSparkLook,
  ingestFrame,
  orbitOmega,
  orreryArms,
  orreryEscapement,
  orreryFailed,
  orreryHudSkipCount,
  orreryWorkBudget,
  packOrrerySlots,
  parseOrreryWorkBudgetYaml,
  planetRadius,
  planetTypeFor,
  setOrreryOptions,
} from "./orrery";
import { SHIPPED_ORRERY_WORK_BUDGET } from "./work-budget";
import { pluginShaderError, probePluginSkyCompile, wrapPluginSky } from "./sky-probe";

const DT = 1 / 60;
const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix", "lego"];

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
    slots = packOrrerySlots(fr);
  }
  return slots;
}

beforeEach(() => {
  disposeOrreryPack();
  setOrreryOptions(parseOrreryOptions({}));
});

describe("orrery pack", () => {
  it("declares mapping, work budget in yaml", () => {
    expect(VIS).toMatch(/dataMapping:/);
    expect(parseOrreryWorkBudgetYaml(VIS)).toEqual(SHIPPED_ORRERY_WORK_BUDGET);
    expect(orreryWorkBudget()).toEqual(SHIPPED_ORRERY_WORK_BUDGET);
    for (const row of ORRERY_DATA_MAPPING) {
      expect(VIS).toContain(row.effect);
      expect(MAPPING).toContain(row.effect);
    }
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    for (const id of ["orrery-study", "orrery-machine", "orrery-planets"]) {
      expect(PLUGIN).toContain(`path: assets/${id}.glb`);
      expect(PLUGIN).toContain(`path: assets/${id}-hd.glb`);
    }
    expect(VIS).toMatch(/key: modelSet/);
    expect(VIS).toMatch(/stageOnly: true/);
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
    // the fail plaque is steady: nothing in the shader modulates it by time
    expect(FRAG).not.toMatch(/uTime/);
  });

  it("clamps options from config.read strings only", () => {
    const o = parseOrreryOptions({ preset: "grand", planetCap: "12", orbitSpeed: "9", sparkCap: "99", failThreshold: "0", cameraMode: "spin", sparks: "false" });
    expect(o.preset).toBe("grand");
    expect(o.planetCap).toBe(8);
    expect(o.orbitSpeed).toBe(2);
    expect(o.sparkCap).toBe(32);
    expect(o.failThreshold).toBe(0.05);
    expect(o.cameraMode).toBe("drift");
    expect(o.sparks).toBe(false);
    expect(parseOrreryOptions({ preset: "night-watch" }).cameraMode).toBe("low");
    // arms + planets + sparks never exceed the instance cap
    const tight = parseOrreryOptions({ planetCap: "8" }, 30);
    expect(2 * tight.planetCap + tight.sparkCap).toBeLessThanOrEqual(30);
  });

  it("maps rate to orbit speed and byte volume to planet size, monotonic and clamped", () => {
    const r = ORRERY.arms[3]!.radius;
    expect(orbitOmega(0, r)).toBeGreaterThan(0);
    expect(orbitOmega(50, r)).toBeGreaterThan(orbitOmega(5, r));
    expect(orbitOmega(1e6, r)).toBeCloseTo(orbitOmega(400, r), 6);
    expect(orbitOmega(50, ORRERY.arms[0]!.radius)).toBeGreaterThan(orbitOmega(50, ORRERY.arms[7]!.radius));
    expect(planetRadius(0)).toBeCloseTo(0.02, 6);
    expect(planetRadius(1e4)).toBeGreaterThan(planetRadius(1e2));
    expect(planetRadius(1e12)).toBeCloseTo(0.038, 6);
    expect(planetTypeFor({ id: "x", role: "gateway" })).toBe(6);
    expect(planetTypeFor({ id: "x", role: "self" })).toBe(0);
    expect(planetTypeFor({ id: "a", role: "lan" })).toBe(planetTypeFor({ id: "a", role: "internet" }));
  });

  it("keeps planets on their arms through rate churn (2 s hold, 1.2x challenger)", () => {
    run(240, { talkers: TALKERS });
    const before = orreryArms().slice(0, 5).map((a) => a.shown);
    expect(new Set(before).size).toBe(5);
    // the bottom two swap rank by a small margin every frame: no arm changes owner
    run(240, (f) => ({
      talkers: TALKERS.map((t, i) => (i >= 3 ? { ...t, rate: f % 2 ? 12 - i : 3 + i } : t)),
    }));
    expect(orreryArms().slice(0, 5).map((a) => a.shown)).toEqual(before);
    // a new heavy talker takes an arm only after the hold, and fades in rather than popping
    const newcomer = { id: "10.0.0.50", rate: 900, role: "lan" };
    setOrreryOptions(parseOrreryOptions({ planetCap: "5" }));
    run(30, { talkers: [...TALKERS, newcomer] });
    expect(orreryArms().some((a) => a.shown === newcomer.id && a.present > 0.9)).toBe(false);
    run(360, { talkers: [...TALKERS, newcomer] });
    expect(orreryArms().slice(0, 5).some((a) => a.shown === newcomer.id)).toBe(true);
  });

  it("ticks the escapement every half second and slows to an uneven tick while failed", () => {
    run(600, { talkers: TALKERS });
    const healthy = orreryEscapement().index;
    expect(healthy).toBeGreaterThanOrEqual(19);
    expect(healthy).toBeLessThanOrEqual(21);
    expect(beatLength(3, false, 1)).toBeCloseTo(BEAT_S, 6);
    const lens = Array.from({ length: 12 }, (_, i) => beatLength(i, true, 1));
    for (const l of lens) expect(l).toBeGreaterThan(BEAT_S * 2.1);
    expect(Math.max(...lens) - Math.min(...lens)).toBeGreaterThan(0.1);
    disposeOrreryPack();
    run(900, { talkers: TALKERS, sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.5 } });
    expect(orreryFailed()).toBe(true);
    const i0 = orreryEscapement().index;
    run(600, { talkers: TALKERS, sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.5 } });
    expect(orreryEscapement().index - i0).toBeLessThan(10);
  });

  it("holds the fail plaque steady while sys.failed flaps around the threshold", () => {
    run(600, { sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.5 } });
    expect(orreryFailed()).toBe(true);
    let toggles = 0;
    let last = orreryFailed();
    for (let f = 0; f < 600; f++) {
      const slots = run(1, { sys: { ...EMPTY_SYS_TELEMETRY, failed: f % 20 < 10 ? 0.25 : 0.15 } });
      const on = slots[0]![OR_SLOT.failed] === 1;
      if (on !== last) toggles++;
      last = on;
    }
    expect(toggles).toBe(0);
  });

  it("live packets run as sparks along the gear train, capped by the pool and the frame budget", () => {
    setOrreryOptions(parseOrreryOptions({ sparkCap: "12" }));
    const packets = Array.from({ length: 20 }, (_, i) => ({ proto: i % 2 ? "UDP" : "TCP", size: 400 + i, field: 0.3 }));
    let maxSparks = 0;
    let flashed = 0;
    for (let f = 0; f < 600; f++) {
      const slots = run(1, { talkers: TALKERS, packets });
      maxSparks = Math.max(maxSparks, slots[0]![OR_SLOT.sparks]!);
      for (let k = 0; k < 8; k++) flashed = Math.max(flashed, slots[OR_ARM_SLOT]![k * OR_ARM_FLOATS + OR_ARM.flash]!);
      const n = slots[0]![OR_SLOT.sparks]!;
      for (let i = 0; i < n; i++) {
        const buf = slots[OR_SPARK_SLOT0 + Math.floor(i / 16)]!;
        const o = (i % 16) * 4;
        expect(Math.hypot(buf[o]!, buf[o + 2]!)).toBeLessThan(0.5);
        expect(buf[o + 1]!).toBeGreaterThan(0.08);
        expect(buf[o + 1]!).toBeLessThan(0.42);
        const { hue, intensity } = decodeSparkLook(buf[o + 3]!);
        expect(hue).toBeGreaterThan(0.05);
        expect(hue).toBeLessThan(0.16);
        expect(intensity).toBeGreaterThan(0);
      }
    }
    expect(maxSparks).toBeGreaterThan(4);
    expect(maxSparks).toBeLessThanOrEqual(12);
    expect(flashed).toBeGreaterThan(0.2);
    expect(orreryHudSkipCount()).toBeGreaterThan(0);
    expect(OR_MAX_SPARKS).toBe(32);
    expect(decodeSparkLook(encodeSparkLook(0.1, 0.5)).intensity).toBeCloseTo(0.5, 5);
  });

  it("demo frames never leave the desk empty", () => {
    const slots = run(300, { demo: true });
    expect(slots[0]![OR_SLOT.idle]).toBe(1);
    const arms = slots[OR_ARM_SLOT]!;
    let planets = 0;
    for (let k = 0; k < 8; k++) if (arms[k * OR_ARM_FLOATS + OR_ARM.type]! >= 0 && arms[k * OR_ARM_FLOATS + OR_ARM.size]! > 0.01) planets++;
    expect(planets).toBe(5);
  });

  it("packs slot geometry contract", () => {
    const slots = run(120, { talkers: TALKERS });
    expect(slots).toHaveLength(4);
    for (const s of slots) expect(s.length).toBe(64);
    const h = slots[0]!;
    expect(h[OR_SLOT.mark]).toBe(1);
    expect(h[OR_SLOT.fov]).toBeCloseTo(30, 3);
    expect(h[OR_SLOT.eyeZ]).toBeGreaterThan(1);
    expect(h[OR_SLOT.arms]).toBe(7);
    // gear ratios: crown and gear-2 turn with the escape wheel through 20:36:60
    expect(h[OR_SLOT.gear2]! / h[OR_SLOT.gear3]!).toBeCloseTo(-20 / 36, 5);
    expect(h[OR_SLOT.gearCrown]! / h[OR_SLOT.gear3]!).toBeCloseTo(20 / 60, 5);
    const a = slots[OR_ARM_SLOT]!;
    for (let k = 0; k < 7; k++) {
      expect(a[k * OR_ARM_FLOATS + OR_ARM.radius]).toBeCloseTo(ORRERY.arms[k]!.radius, 5);
      expect(a[k * OR_ARM_FLOATS + OR_ARM.hub]).toBeCloseTo(ORRERY.arms[k]!.hub, 5);
      expect(a[k * OR_ARM_FLOATS + OR_ARM.present]).toBe(1);
    }
    expect(a[7 * OR_ARM_FLOATS + OR_ARM.present]).toBe(0);
  });

  it("is deterministic for the same frames", () => {
    const a = Array.from(run(400, { talkers: TALKERS, packets: [{ proto: "TCP", size: 600, field: 0.4 }] })[OR_ARM_SLOT]!);
    disposeOrreryPack();
    const b = Array.from(run(400, { talkers: TALKERS, packets: [{ proto: "TCP", size: 600, field: 0.4 }] })[OR_ARM_SLOT]!);
    expect(b).toEqual(a);
  });

  it("reduced motion holds the camera still", () => {
    setOrreryOptions(parseOrreryOptions({ reducedMotion: "on" }));
    const a = Array.from(run(60).slice(0, 1)[0]!.subarray(1, 4));
    const b = Array.from(run(1800)[0]!.subarray(1, 4));
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i]!, 4);
    disposeOrreryPack();
    const c = Array.from(run(60)[0]!.subarray(1, 4));
    const d = Array.from(run(1800)[0]!.subarray(1, 4));
    expect(Math.abs(d[0]! - c[0]!)).toBeGreaterThan(0.01);
  });
});
