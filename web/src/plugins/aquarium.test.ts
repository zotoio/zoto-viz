import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/aquarium/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/aquarium/frontend/index.ts?raw";
import VIS from "../../../plugins/src/aquarium/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/aquarium/plugin.yml?raw";
import MAPPING from "../../../plugins/src/aquarium/data-mapping.yml?raw";
import {
  AQUARIUM_WORK_BUDGET,
  AquariumSim,
  CONFIG_KEYS,
  DEFAULT_OPTIONS,
  FAIL_MURK_THRESHOLD,
  MAX_FISH,
  MAX_PARTICLES,
  PACKET_FRAME_CAP,
  PRESET_CAPS,
  PRESET_IDS,
  aquariumHudLabel,
  aquariumSmokeLuma,
  assertWorkBudgetUnderCaps,
  failureVisuals,
  packNameCheck,
  parseAquariumOptions,
  scanPackTrademarks,
  speciesForTalker,
} from "../../../plugins/src/aquarium/frontend/aquarium";
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

describe("aquarium shipped pack", () => {
  it("name check: Aquarium at plugin:aquarium; no trademark hits in pack text", () => {
    expect(packNameCheck()).toEqual({
      id: "aquarium",
      name: "Aquarium",
      view: "plugin:aquarium",
    });
    expect(PLUGIN).toContain("id: aquarium");
    expect(PLUGIN).toContain("data-mapping.yml");
    const hits = scanPackTrademarks(PLUGIN, VIS, FRAG, FRONT, MAPPING);
    expect(hits).toEqual([]);
  });

  it("wraps and compiles the aquarium sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toContain("mapScene");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("presets are valid and clamp fish to per-preset caps", () => {
    for (const preset of PRESET_IDS) {
      const o = parseAquariumOptions({ preset, fishCount: "99" });
      expect(o.preset).toBe(preset);
      expect(o.fishCount).toBeLessThanOrEqual(PRESET_CAPS[preset].maxFish);
      expect(o.fishCount).toBeGreaterThanOrEqual(2);
    }
  });

  it("work budget counts stay under plugin.yml caps at every preset", () => {
    const packets = Array.from({ length: 12 }, (_, i) => ({
      proto: `udp${i}`,
      size: 120 + i,
      field: 0.5,
    }));
    for (const preset of PRESET_IDS) {
      const sim = new AquariumSim(parseAquariumOptions({ preset, fishCount: "16" }));
      const packed = sim.advance(frame({ packets, talkers }));
      expect(assertWorkBudgetUnderCaps(sim.lastWork, preset)).toBe(true);
      expect(sim.lastWork.fish).toBeLessThanOrEqual(MAX_FISH);
      expect(sim.lastWork.particles).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(sim.lastWork.raymarchSteps).toBe(AQUARIUM_WORK_BUDGET.raymarchSteps);
      expect(packed.particleCount).toBeLessThanOrEqual(PRESET_CAPS[preset].maxParticles);
    }
  });

  it("parses every config key declared in visualisation.yml", () => {
    const ymlKeys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    for (const k of CONFIG_KEYS) expect(ymlKeys).toContain(k);
    for (const k of ymlKeys) expect(CONFIG_KEYS as readonly string[]).toContain(k);
  });

  it("reads every view setting key from visualisation.yml", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    const a = JSON.stringify(parseAquariumOptions({}));
    for (const key of keys) {
      if (key === "preset" || key.startsWith("sp_") || key === "randomise" || key === "undoRandom" || key === "resetSettings") continue;
      const block = VIS.split(`key: ${key}`)[1]!.split("- key:")[0]!;
      const def = block.match(/default: (\S+)/)?.[1] ?? "";
      const flip = /true|false/.test(def)
        ? (def === "true" ? "false" : "true")
        : key === "water"
          ? "reef"
          : key === "lighting"
            ? "moonlight"
            : key === "camera"
              ? "hold"
              : key === "fishCount"
                ? "4"
                : key === "seed"
                  ? "1"
                  : key === "feedingMin"
                    ? "15"
                    : "0.15";
      expect(JSON.stringify(parseAquariumOptions({ [key]: flip })), key).not.toBe(a);
    }
  });

  it("is deterministic with a pinned seed", () => {
    const simA = new AquariumSim(parseAquariumOptions({ seed: "777", preset: "planted", fishCount: "6" }));
    const simB = new AquariumSim(parseAquariumOptions({ seed: "777", preset: "planted", fishCount: "6" }));
    const f = frame({ t: 12.5, talkers });
    const a = simA.advance(f);
    const b = simB.advance(f);
    expect(Array.from(a.slot0)).toEqual(Array.from(b.slot0));
    expect(Array.from(a.slot1)).toEqual(Array.from(b.slot1));
  });

  it("reorder talkers with same count keeps each fish with its id", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "planted", fishCount: "3" }));
    const shuffled = [talkers[2]!, talkers[0]!, talkers[1]!];
    sim.advance(frame({ talkers }));
    const snapA = sim.fishSpeciesById();
    sim.advance(frame({ t: 2, talkers: shuffled }));
    const snapB = sim.fishSpeciesById();
    expect(snapA.size).toBe(3);
    expect(snapB.size).toBe(3);
    for (const [id, sp] of snapA) expect(snapB.get(id)).toBe(sp);
  });

  it("healthy low-size packets produce no failure visuals", () => {
    const sim = new AquariumSim(DEFAULT_OPTIONS);
    const packed = sim.advance(frame({
      packets: [{ proto: "dns", size: 48, field: 0.12 }],
      sys: { failed: 0.05 },
    }));
    expect(failureVisuals({ failed: 0.05 }).murk).toBe(0);
    expect(packed.failBanner).toBe(0);
    expect(packed.murk).toBe(0);
  });

  it("sys.failed over threshold murks water and shows banner", () => {
    const hi = FAIL_MURK_THRESHOLD + 0.2;
    const fx = failureVisuals({ failed: hi });
    expect(fx.murk).toBeGreaterThan(0.1);
    expect(fx.banner).toBe(1);
    const sim = new AquariumSim(DEFAULT_OPTIONS);
    const packed = sim.advance(frame({ sys: { failed: hi } }));
    expect(packed.murk).toBeGreaterThan(0);
    expect(packed.failBanner).toBe(1);
  });

  it("consumes packets up to the per-frame cap (not only packets[0])", () => {
    const sim = new AquariumSim(DEFAULT_OPTIONS);
    const packets = Array.from({ length: 24 }, (_, i) => ({
      proto: `tcp${i}`,
      size: 200 + i,
      field: 0.4,
    }));
    sim.advance(frame({ t: 0, packets }));
    sim.advance(frame({ t: 0.02, packets }));
    expect(sim.lastPacketIngest).toBeLessThanOrEqual(PACKET_FRAME_CAP);
    expect(sim.lastPacketIngest).toBe(PACKET_FRAME_CAP);
  });

  it("demo idle label reads aquarium · preset · demo", () => {
    const o = parseAquariumOptions({ preset: "calm_zen" });
    expect(aquariumHudLabel(o, true, "demo")).toBe("aquarium · Calm Zen · demo");
    const idle = buildIdleVizFrame(4.2);
    const sim = new AquariumSim(o);
    const packed = sim.advance({ ...idle, demo: true, packets: idle.packets.map((p) => ({
      proto: p.proto,
      size: p.size,
      field: p.field,
    })) });
    expect(packed.label).toContain("demo");
    expect(packed.slot0[19]).toBe(1);
    expect(packed.slot0[17]).toBeGreaterThan(0);
  });

  it("non-black smoke render heuristic from packed demo frame", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "reef_lagoon", seed: "1204" }));
    const idle = buildIdleVizFrame(2);
    const packed = sim.advance({
      ...idle,
      demo: true,
      packets: idle.packets.map((p) => ({ proto: p.proto, size: p.size, field: p.field })),
    });
    expect(aquariumSmokeLuma(packed)).toBeGreaterThan(0.12);
  });

  it("species toggles change reef options on a reef preset", () => {
    const base = parseAquariumOptions({ preset: "reef_lagoon" });
    const off = parseAquariumOptions({ preset: "reef_lagoon", sp_clown: "false" });
    expect(off.reefSpecies[0]).toBe(0);
    expect(base.reefSpecies[0]).toBe(1);
  });

  it("gateway maps to largest freshwater species when enabled", () => {
    const o = parseAquariumOptions({ preset: "planted", sp_discus: "true" });
    expect(speciesForTalker("gw", "gateway", o)).toBe(4);
  });

  it("20× tile mount/unmount frees subscriptions and records zero extra GL contexts on 4×4", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "night_reef", seed: "42" }));
    for (let i = 0; i < 20; i++) {
      sim.mountTile();
      sim.advance(frame({ t: i * 0.5 }));
      sim.unmountTile();
    }
    expect(sim.tileSubscriptions()).toBe(0);
    expect(sim.tileRafHooks()).toBe(0);
    expect(AQUARIUM_WORK_BUDGET.glContextsOn4x4Wall).toBe(0);
    sim.setOptions(parseAquariumOptions({ preset: "night_reef", seed: "42" }));
    const packed = sim.advance(frame({ demo: true }));
    expect(packed.slot0[0]).toBe(1);
  });

  it("no per-frame allocation after warm-up", () => {
    const sim = new AquariumSim(parseAquariumOptions({ seed: "909" }));
    const f = frame({
      packets: [{ proto: "udp", size: 96, field: 0.3 }],
    });
    for (let i = 0; i < 8; i++) sim.advance({ ...f, t: f.t + i * 0.016 });
    expect(sim.isWarmed()).toBe(true);
    const s0 = sim.slot0;
    const s1 = sim.slot1;
    const s2 = sim.slot2;
    const scratch = sim.particleScratch;
    for (let i = 0; i < 24; i++) sim.advance({ ...f, t: f.t + i * 0.016 });
    expect(sim.slot0).toBe(s0);
    expect(sim.slot1).toBe(s1);
    expect(sim.slot2).toBe(s2);
    expect(sim.particleScratch).toBe(scratch);
  });
});
