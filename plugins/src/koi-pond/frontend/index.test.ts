import { describe, expect, it, vi } from "vitest";
import FRAG from "../sky/fragment.glsl?raw";
import FRONT from "./index.ts?raw";
import VIS from "../visualisation.yml?raw";
import PLUGIN from "../plugin.yml?raw";
import MAPPING from "../data-mapping.yml?raw";
import {
  assertWorkBudgetUnderCaps,
  assignTalkerSlots,
  assignTalkerSlotsEmptySlotSearches,
  resetAssignTalkerSlotsStats,
  CONFIG_KEYS,
  DEFAULT_OPTIONS,
  demoFrame,
  FAIL_MURK_THRESHOLD,
  hostTileSizeFromConfig,
  KOI_SLOT,
  KOI_WORK_BUDGET,
  KoiPondSim,
  lilyPadSlotCount,
  koiPondHudLabel,
  koiPondLumaVariance,
  koiPondSmokeLuma,
  failureVisuals,
  packKoiMeta,
  packNameCheck,
  parseKoiPondOptions,
  patternForTalker,
  pondBloomFromTraffic,
  PRESET_IDS,
  PRESET_CAPS,
  QUALITY_CAPS,
  randomKoiConfig,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
  tileInternalResScale,
  totalTalkerRate,
  unpackKoiMeta,
} from "./koi-pond";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame, type VizSysTelemetry } from "../../../sdk/viz-contract";
import { probePluginSkyCompile, wrapPluginSky } from "./sky-compile";

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
  sys?: VizSysTelemetry;
  demo?: boolean;
}> = {}): VizDataFrame => ({
  t: 1,
  dt: 1 / 60,
  audio: 0.1,
  talkers,
  packets: [] as { proto: string; size: number; field: number }[],
  rf: [],
  headlines: [],
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
    expect(FRAG).toContain("s * 64");
    expect(FRAG).not.toMatch(/vec3\(\s*xz\s*\*[^)]*,[^)]*,/);
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
    expect(FRONT).toContain("KoiPondSim");
    expect(FRONT).not.toMatch(/\bparent\s*\.\s*document\b/);
    expect(FRONT).not.toMatch(/host\.onFrame\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?getConfig/);
    expect(VIS).not.toContain("Applies to all Koi Pond tiles");
    expect(VIS).toContain("Preset sets water, lotus, and motion baselines");
    expect(VIS).toContain("moonlit_lotus");
    expect(MAPPING).toContain("pond-wide");
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
    const idlePacked = sim.advance({ ...demoFrame(3), demo: true });
    expect(idlePacked.slot0[26]).toBe(1);
  });

  it("sys.failed murks water with steady banner flag", () => {
    const hi = FAIL_MURK_THRESHOLD + 0.25;
    expect(failureVisuals({ failed: hi }).banner).toBe(1);
    const sim = new KoiPondSim(DEFAULT_OPTIONS);
    const packed = sim.advance(frame({ sys: { ...EMPTY_SYS_TELEMETRY, failed: hi } }));
    expect(packed.murk).toBeGreaterThan(0.1);
    expect(packed.failBanner).toBe(1);
  });

  it("smoke luma from demo advance is non-black", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ seed: "42" }));
    const packed = sim.advance(demoFrame(1.5));
    expect(koiPondSmokeLuma(packed)).toBeGreaterThan(0.1);
  });

  it("zero talkers still paints idle koi, water, and particles (no blackout)", () => {
    const emptyFrame = (t: number): VizDataFrame => ({
      t,
      dt: 1 / 60,
      audio: 0,
      packets: [],
      rf: [],
      talkers: [],
      headlines: [],
      sys: {
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
      } satisfies VizSysTelemetry,
      demo: false,
    });
    const sim = new KoiPondSim(
      parseKoiPondOptions({ preset: "festival_lanterns", timeOfDay: "night", petalDrift: "true" }),
    );
    let packed = sim.advance(emptyFrame(0));
    for (let i = 1; i <= 90; i++) {
      packed = sim.advance(emptyFrame(i / 60));
    }
    expect(sim.slottedKoiCount()).toBeGreaterThan(0);
    expect(packed.particleCount).toBeGreaterThan(0);
    expect(packed.bright).toBeGreaterThan(0.15);
    expect(packed.bg[0] + packed.bg[1] + packed.bg[2]).toBeGreaterThan(0.08);
    expect(koiPondSmokeLuma(packed)).toBeGreaterThan(0.08);
    expect(packed.slot0[24]).toBeGreaterThan(0);
  });

  it("packs koi meta round-trip", () => {
    const packed = packKoiMeta(3, 0.42);
    const out = unpackKoiMeta(packed);
    expect(out.pattern).toBe(3);
    expect(out.vigor).toBeCloseTo(0.42, 4);
  });

  it("gateway maps to kohaku when enabled", () => {
    const o = parseKoiPondOptions({ varietyMix: "0" });
    expect(patternForTalker("gw", "gateway", o)).toBe(0);
  });

  it("voxel #22 talker slot hysteresis", () => {
    const out: (null | { id: string; assignedAt: number; rate: number })[] = [];
    const occ = new Set<string>();
    const pools = { out, occupied: occ };
    const map = (list: { id: string; rate: number }[]) =>
      new Map(list.map((t) => [t.id, t]));
    let slots: (null | { id: string; assignedAt: number; rate: number })[] = [null, null];
    const a = { id: "a", rate: 100 };
    const b = { id: "b", rate: 80 };
    slots = assignTalkerSlots(map([a, b]), slots, 2, 0, pools);
    expect(slottedTalkerIds(slots).sort()).toEqual(["a", "b"]);
    const c = { id: "c", rate: 200 };
    slots = assignTalkerSlots(map([a, b, c]), slots, 2, TALKER_SLOT_HOLD_S + 0.2, pools);
    expect(slottedTalkerIds(slots)).toContain("c");
    expect(c.rate).toBeGreaterThanOrEqual(a.rate * TALKER_SLOT_CHALLENGER_MARGIN);
    slots = assignTalkerSlots(map([b, c]), slots, 2, TALKER_SLOT_HOLD_S + 1, pools);
    expect(slottedTalkerIds(slots)).not.toContain("a");
  });

  it("skips empty-slot searches and Array.sort once talker slots are full", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `host:${i}`,
      rate: 200 - i,
      role: "lan",
    }));
    const sim = new KoiPondSim(
      parseKoiPondOptions({ preset: "sunrise_feed", koiCap: "16", quality: "high" }),
    );
    for (let i = 0; i < 120; i++) {
      sim.advance(frame({ t: i / 60, talkers: many }));
    }
    expect(sim.slottedKoiCount()).toBe(16);
    resetAssignTalkerSlotsStats();
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    for (let i = 0; i < 300; i++) {
      sim.advance(frame({ t: (120 + i) / 60, talkers: many }));
    }
    expect(assignTalkerSlotsEmptySlotSearches).toBe(0);
    expect(sortSpy).not.toHaveBeenCalled();
    sortSpy.mockRestore();
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

  it("host tile size comes from config keys, not DOM", () => {
    expect(hostTileSizeFromConfig({ hostTileW: "640", hostTileH: "360" })).toEqual({ w: 640, h: 360 });
    expect(hostTileSizeFromConfig({})).toEqual({ w: 1280, h: 800 });
  });

  it("presets clamp koi to per-preset caps", () => {
    for (const preset of PRESET_IDS) {
      const o = parseKoiPondOptions({ preset, koiCap: "99", quality: "high" });
      expect(o.preset).toBe(preset);
      expect(o.koiCap).toBeLessThanOrEqual(PRESET_CAPS[preset].maxKoi);
    }
  });

  it("pond bloom follows total talker rate, not a single host", () => {
    const low = pondBloomFromTraffic(totalTalkerRate([{ rate: 40 }]), true);
    const high = pondBloomFromTraffic(totalTalkerRate(talkers), true);
    expect(high).toBeGreaterThan(low);
    const sim = new KoiPondSim(parseKoiPondOptions({ lilyDensity: "0.2" }));
    sim.advance(frame({ talkers: [{ id: "a", rate: 400, role: "lan" }] }));
    const packed = sim.advance(frame({ talkers }));
    const b0 = packed.slot2[1];
    const b1 = packed.slot2[5];
    expect(b0).toBeCloseTo(b1, 3);
  });

  it("all-minimum settings render non-empty", () => {
    const cfg: Record<string, string> = {
      preset: "zen_garden",
      koiCap: "2",
      koiSize: "0.5",
      varietyMix: "0",
      swimSpeed: "0",
      schooling: "0",
      lilyDensity: "0",
      lotusCount: "0",
      waterTint: "0",
      waterClarity: "0",
      rippleIntensity: "0",
      causticStrength: "0",
      quality: "low",
      seed: "1",
      bloomOnActivity: "false",
      caustics: "false",
      petalDrift: "false",
      dragonflies: "false",
      rain: "false",
      cameraDrift: "false",
      label: "false",
      legend: "false",
      reducedMotion: "true",
      pat_kohaku: "true",
      pat_sanke: "false",
      pat_showa: "false",
      pat_ogon: "false",
      pat_tancho: "false",
      pat_asagi: "false",
    };
    const sim = new KoiPondSim(parseKoiPondOptions(cfg));
    const packed = sim.advance(demoFrame(1));
    expect(koiPondSmokeLuma(packed)).toBeGreaterThan(0.05);
  });

  it("all-maximum settings stay within caps", () => {
    const cfg: Record<string, string> = {
      preset: "sunrise_feed",
      koiCap: "99",
      koiSize: "1.8",
      varietyMix: "1",
      swimSpeed: "1",
      schooling: "1",
      lilyDensity: "1",
      lotusCount: "8",
      waterTint: "1",
      waterClarity: "1",
      rippleIntensity: "1",
      causticStrength: "1",
      quality: "high",
      seed: "99999",
      bloomOnActivity: "true",
      caustics: "true",
      petalDrift: "true",
      dragonflies: "true",
      rain: "true",
      cameraDrift: "true",
      label: "true",
      legend: "true",
      reducedMotion: "false",
    };
    const o = parseKoiPondOptions(cfg);
    const sim = new KoiPondSim(o);
    sim.advance(frame({ packets: [{ proto: "tcp", size: 200, field: 0.9 }] }));
    expect(assertWorkBudgetUnderCaps(sim.lastWork, o.quality, o.preset)).toBe(true);
    expect(o.koiCap).toBeLessThanOrEqual(PRESET_CAPS[o.preset].maxKoi);
    expect(o.lotusCount).toBeLessThanOrEqual(8);
  });

  it("50 seeded randomise configs parse valid and render non-empty", () => {
    for (let i = 0; i < 50; i++) {
      const cfg = randomKoiConfig(1000 + i * 17);
      const o = parseKoiPondOptions(cfg);
      expect(PRESET_IDS).toContain(o.preset);
      expect(o.koiCap).toBeGreaterThanOrEqual(2);
      const sim = new KoiPondSim(o);
      const packed = sim.advance(demoFrame(0.5 + i * 0.01));
      expect(koiPondSmokeLuma(packed)).toBeGreaterThan(0.04);
    }
  });

  it("Moonlit Lotus keeps visible detail (luma variance floor)", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ preset: "moonlit_lotus", seed: "4242" }));
    const lumas: number[] = [];
    for (let i = 0; i < 12; i++) {
      const scaled = talkers.map((t, j) => ({
        ...t,
        rate: t.rate * (0.4 + i * 0.12 + j * 0.05),
      }));
      const packed = sim.advance(frame({
        t: i * 0.3,
        talkers: scaled,
        audio: 0.06 + (i % 5) * 0.09,
        packets: i % 3 === 0 ? [{ proto: "udp", size: 96, field: 0.5 }] : [],
      }));
      lumas.push(koiPondSmokeLuma(packed));
    }
    expect(koiPondLumaVariance(lumas)).toBeGreaterThan(0.0003);
    expect(Math.max(...lumas)).toBeGreaterThan(0.12);
  });

  it("packs koi pattern and vigor into one meta slot per fish", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ koiCap: "4" }));
    sim.advance(frame());
    const meta = sim.slot0[35]!;
    const unpacked = unpackKoiMeta(meta);
    expect(unpacked.pattern).toBeGreaterThanOrEqual(0);
    expect(unpacked.vigor).toBeGreaterThan(0);
    expect(sim.slot0[48]).toBe(0);
  });

  it("reuses step containers over 300 idle frames", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ petalDrift: "false" }));
    const empty = (t: number): VizDataFrame => ({
      t,
      dt: 1 / 60,
      audio: 0,
      packets: [],
      rf: [],
      talkers: [],
      headlines: [],
      sys: {
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
      } satisfies VizSysTelemetry,
      demo: false,
    });
    let c = sim.stepContainers();
    const { talkerById, idleTalkers, slottedIds, slottedTalkers } = c;
    for (let i = 0; i < 300; i++) {
      sim.advance(empty(i / 60));
      c = sim.stepContainers();
      expect(c.talkerById).toBe(talkerById);
      expect(c.idleTalkers).toBe(idleTalkers);
      expect(c.slottedIds).toBe(slottedIds);
      expect(c.slottedTalkers).toBe(slottedTalkers);
    }
  });

  it("reuses step containers over 300 frames with 200 host talkers", () => {
    const sim = new KoiPondSim(parseKoiPondOptions({ koiCap: "16", quality: "high" }));
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `host:${i}`,
      rate: 40 + (i % 17),
      role: i % 5 === 0 ? "gateway" : "lan",
    }));
    let c = sim.stepContainers();
    const { talkerById, idleTalkers, slottedIds, slottedTalkers } = c;
    for (let i = 0; i < 300; i++) {
      sim.advance(frame({ t: i / 60, talkers: many }));
      c = sim.stepContainers();
      expect(c.talkerById).toBe(talkerById);
      expect(c.idleTalkers).toBe(idleTalkers);
      expect(c.slottedIds).toBe(slottedIds);
      expect(c.slottedTalkers).toBe(slottedTalkers);
    }
  });

  it("clears slot2 particle region when shader particle count reaches zero", () => {
    const o = parseKoiPondOptions({ petalDrift: "false", rippleIntensity: "0.15" });
    const sim = new KoiPondSim(o);
    const lan = [{ id: "burst", rate: 200, role: "lan" }];
    sim.advance(frame({
      talkers: lan,
      packets: [{ proto: "udp", size: 80, field: 0.8 }],
    }));
    let packed = sim.advance(frame({ talkers: lan, packets: [] }));
    for (let i = 0; i < 420; i++) {
      packed = sim.advance(frame({ t: i / 60, talkers: lan, packets: [] }));
    }
    expect(packed.slot0[KOI_SLOT.particleCount]).toBe(0);
    const base = lilyPadSlotCount(o.lilyDensity) * 4;
    for (let i = base; i < 64; i++) expect(packed.slot2[i]).toBe(0);
  });
});
