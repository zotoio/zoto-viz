import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/koi-pond/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/koi-pond/frontend/index.ts?raw";
import VIS from "../../../plugins/src/koi-pond/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/koi-pond/plugin.yml?raw";
import MAPPING from "../../../plugins/src/koi-pond/data-mapping.yml?raw";
import {
  assertWorkBudgetUnderCaps,
  assignTalkerSlots,
  CONFIG_KEYS,
  DEFAULT_OPTIONS,
  demoFrame,
  FAIL_MURK_THRESHOLD,
  KOI_WORK_BUDGET,
  KoiPondSim,
  koiPondHudLabel,
  koiPondSmokeLuma,
  failureVisuals,
  packKoiMeta,
  packNameCheck,
  parseKoiPondOptions,
  patternForTalker,
  QUALITY_CAPS,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
  tileInternalResScale,
  unpackKoiMeta,
} from "../../../plugins/src/koi-pond/frontend/koi-pond";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

const talkers = [
  { id: "10.0.0.1", rate: 180, role: "gateway" },
  { id: "10.0.0.42", rate: 120, role: "lan" },
  { id: "8.8.8.8", rate: 90, role: "internet" },
];

const frame = (over: Partial<{
  t: number;
  dt: number;
  audio: number;
  talkers: typeof talkers;
  packets: { proto: string; size: number; field: number }[];
  sys?: { failed: number };
  demo?: boolean;
}> = {}) => ({
  t: 1,
  dt: 1 / 60,
  audio: 0.1,
  talkers,
  packets: [] as { proto: string; size: number; field: number }[],
  demo: false,
  ...over,
});

describe("koi-pond shipped pack", () => {
  it("registers plugin:koi-pond id and mapping file", () => {
    expect(packNameCheck()).toEqual({
      id: "koi-pond",
      name: "Koi Pond",
      view: "plugin:koi-pond",
    });
    expect(PLUGIN).toContain("id: koi-pond");
    expect(PLUGIN).toContain("data-mapping.yml");
    expect(MAPPING).toContain("talkers[].id");
  });

  it("wraps and compiles the koi pond sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
    expect(FRONT).toContain("KoiPondSim");
  });

  it("quality presets clamp koi cap", () => {
    for (const q of ["low", "medium", "high"] as const) {
      const o = parseKoiPondOptions({ quality: q, koiCap: "99" });
      expect(o.koiCap).toBeLessThanOrEqual(QUALITY_CAPS[q].maxKoi);
    }
  });

  it("work budget stays under plugin.yml caps", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ quality: "high", koiCap: "16" }));
    const packed = sim.advance(frame({ packets: [{ proto: "udp", size: 96, field: 0.4 }] }));
    expect(assertWorkBudgetUnderCaps(sim.lastWork, "high")).toBe(true);
    expect(sim.lastWork.koi).toBeLessThanOrEqual(16);
    expect(sim.lastWork.raymarchSteps).toBeLessThanOrEqual(KOI_WORK_BUDGET.raymarchSteps);
    expect(packed.particleCount).toBeLessThanOrEqual(24);
  });

  it("parses every config key in visualisation.yml", () => {
    const ymlKeys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    for (const k of CONFIG_KEYS) expect(ymlKeys).toContain(k);
    for (const k of ymlKeys) expect(CONFIG_KEYS as readonly string[]).toContain(k);
  });

  it("demo frame and idle fixture label demo", () => {
    const o = parseKoiPondOptions({ timeOfDay: "day" });
    expect(koiPondHudLabel(o, true, "demo")).toContain("demo");
    const sim = new KoiPondSim(o);
    const packed = sim.advance(demoFrame(2));
    expect(packed.label).toContain("demo");
    const idle = buildIdleVizFrame(3);
    const idlePacked = sim.advance({ ...idle, demo: true });
    expect(idlePacked.slot0[26]).toBe(1);
  });

  it("sys.failed murks water with steady banner flag", () => {
    const hi = FAIL_MURK_THRESHOLD + 0.25;
    expect(failureVisuals({ failed: hi }).banner).toBe(1);
    const sim = new KoiPondSim(DEFAULT_OPTIONS);
    const packed = sim.advance(frame({ sys: { failed: hi } }));
    expect(packed.murk).toBeGreaterThan(0.1);
    expect(packed.failBanner).toBe(1);
  });

  it("smoke luma from demo advance is non-black", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ seed: "42" }));
    const packed = sim.advance(demoFrame(1.5));
    expect(koiPondSmokeLuma(packed)).toBeGreaterThan(0.1);
  });

  it("packs koi meta round-trip", () => {
    const packed = packKoiMeta(3, 0.42);
    const out = unpackKoiMeta(packed);
    expect(out.pattern).toBe(3);
    expect(out.vigor).toBeCloseTo(0.42, 4);
  });

  it("gateway maps to kohaku when enabled", () => {
    const o = parseKoiPondOptions({});
    expect(patternForTalker("gw", "gateway", o)).toBe(0);
  });

  it("voxel #22 talker slot hysteresis", () => {
    let slots: (null | { id: string; assignedAt: number; rate: number })[] = [null, null];
    const a = { id: "a", rate: 100 };
    const b = { id: "b", rate: 80 };
    slots = assignTalkerSlots([a, b], slots, 2, 0);
    expect(slottedTalkerIds(slots).sort()).toEqual(["a", "b"]);
    const c = { id: "c", rate: 200 };
    slots = assignTalkerSlots([a, b, c], slots, 2, TALKER_SLOT_HOLD_S + 0.2);
    expect(slottedTalkerIds(slots)).toContain("c");
    expect(c.rate).toBeGreaterThanOrEqual(a.rate * TALKER_SLOT_CHALLENGER_MARGIN);
    slots = assignTalkerSlots([b, c], slots, 2, TALKER_SLOT_HOLD_S + 1);
    expect(slottedTalkerIds(slots)).not.toContain("a");
  });

  it("koi body remains until talker leaves host list", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ koiCap: "2" }));
    const low = { id: "low", rate: 50, role: "lan" };
    const high = { id: "high", rate: 120, role: "gateway" };
    const mega = { id: "mega", rate: 260, role: "internet" };
    sim.advance(frame({ t: 0, talkers: [low, high] }));
    expect(sim.slottedKoiCount()).toBe(2);
    sim.advance(frame({ t: TALKER_SLOT_HOLD_S + 0.2, talkers: [low, high, mega] }));
    expect(sim.koiBodiesCount()).toBeGreaterThanOrEqual(2);
    sim.advance(frame({ t: TALKER_SLOT_HOLD_S + 0.5, talkers: [high, mega] }));
    expect(sim.koiPatternById().has("low")).toBe(false);
  });

  it("teardown and tile mount track dispose counts", () => {
    const sim = new KoiPondSim(DEFAULT_OPTIONS);
    const before = sim.glDisposeCount();
    sim.mountTile();
    sim.advance(frame());
    sim.unmountTile();
    expect(sim.glDisposeCount()).toBeGreaterThan(before);
    expect(sim.tileSubscriptions()).toBe(0);
    expect(KOI_WORK_BUDGET.glContextsOn4x4Wall).toBe(0);
  });

  it("no per-frame buffer allocation after warm-up", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ seed: "12" }));
    for (let i = 0; i < 10; i++) sim.advance(frame({ t: i * 0.02 }));
    expect(sim.isWarmed()).toBe(true);
    const s0 = sim.slot0;
    const scratch = sim.particleScratch;
    for (let i = 0; i < 20; i++) sim.advance(frame({ t: i * 0.016 }));
    expect(sim.slot0).toBe(s0);
    expect(sim.particleScratch).toBe(scratch);
  });

  it("passes canvas size into slots for tile scale", () => {
    const sim = new KoiPondSim(DEFAULT_OPTIONS);
    sim.advance(frame(), 320, 240);
    expect(sim.slot0[19]).toBe(320);
    expect(sim.slot0[20]).toBe(240);
    expect(tileInternalResScale(320, 240)).toBe(2);
    expect(sim.slot0[30]).toBe(2);
  });

  it("reduced motion slows time scale in packed slots", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ reducedMotion: "true" }));
    const packed = sim.advance(frame());
    expect(packed.slot0[27]).toBeLessThan(0.5);
  });
});
