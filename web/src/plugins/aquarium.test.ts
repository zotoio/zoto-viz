import { describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/aquarium/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/aquarium/frontend/index.ts?raw";
import VIS from "../../../plugins/src/aquarium/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/aquarium/plugin.yml?raw";
import {
  AquariumSim,
  DEFAULT_OPTIONS,
  FAIL_MURK_THRESHOLD,
  PACKET_FRAME_CAP,
  PRESET_CAPS,
  PRESET_IDS,
  aquariumHudLabel,
  aquariumSmokeLuma,
  failureVisuals,
  fishIdStable,
  packNameCheck,
  parseAquariumOptions,
  speciesForTalker,
} from "../../../plugins/src/aquarium/frontend/aquarium";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

const talkers = [
  { id: "10.0.0.1", rate: 180, role: "gateway" },
  { id: "10.0.0.42", rate: 120, role: "lan" },
  { id: "8.8.8.8", rate: 90, role: "internet" },
];

describe("aquarium shipped pack", () => {
  it("name check: Aquarium at plugin:aquarium", () => {
    expect(packNameCheck()).toEqual({
      id: "aquarium",
      name: "Aquarium",
      view: "plugin:aquarium",
    });
    expect(PLUGIN).toContain("id: aquarium");
    expect(PLUGIN).toContain('name: Aquarium');
    expect(FRONT).toContain("AquariumSim");
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

  it("reads every view setting key from visualisation.yml", () => {
    const keys = [...VIS.matchAll(/- key: (\w+)/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(15);
    const a = JSON.stringify(parseAquariumOptions({}));
    for (const key of keys) {
      if (key === "preset" || key.startsWith("sp_")) continue;
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
    const frame = { t: 12.5, dt: 1 / 60, audio: 0.1, talkers, packets: [], demo: false };
    const a = simA.advance(frame);
    const b = simB.advance(frame);
    expect(Array.from(a.slot0)).toEqual(Array.from(b.slot0));
    expect(Array.from(a.slot1)).toEqual(Array.from(b.slot1));
  });

  it("reorder talkers with same count keeps each fish with its id", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "planted", fishCount: "3" }));
    const shuffled = [talkers[2]!, talkers[0]!, talkers[1]!];
    expect(fishIdStable(sim, talkers, shuffled, sim.getOptions())).toBe(true);
  });

  it("healthy low-size packets produce no failure visuals", () => {
    const sim = new AquariumSim(DEFAULT_OPTIONS);
    const packed = sim.advance({
      t: 1,
      dt: 0.016,
      audio: 0.05,
      talkers,
      packets: [{ proto: "dns", size: 48, field: 0.12 }],
      sys: { failed: 0.05 },
      demo: false,
    });
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
    const packed = sim.advance({
      t: 2,
      dt: 0.016,
      audio: 0.1,
      talkers,
      packets: [],
      sys: { failed: hi },
    });
    expect(packed.murk).toBeGreaterThan(0);
    expect(packed.failBanner).toBe(1);
  });

  it("consumes packets up to the per-frame cap", () => {
    const sim = new AquariumSim(DEFAULT_OPTIONS);
    const packets = Array.from({ length: 24 }, (_, i) => ({
      proto: `tcp${i}`,
      size: 200 + i,
      field: 0.4,
    }));
    sim.advance({ t: 0, dt: 0.016, audio: 0, talkers, packets, demo: false });
    sim.advance({
      t: 0.02,
      dt: 0.016,
      audio: 0,
      talkers,
      packets,
      demo: false,
    });
    expect(sim.lastPacketIngest).toBeLessThanOrEqual(PACKET_FRAME_CAP);
    expect(sim.lastPacketIngest).toBeGreaterThan(0);
  });

  it("demo idle label reads aquarium · preset · demo", () => {
    const o = parseAquariumOptions({ preset: "calm_zen" });
    expect(aquariumHudLabel(o, true)).toBe("aquarium · Calm Zen · demo");
    const idle = buildIdleVizFrame(4.2);
    const sim = new AquariumSim(o);
    const packed = sim.advance({ ...idle, demo: true });
    expect(packed.label).toContain("demo");
    expect(packed.slot0[19]).toBe(1);
    expect(packed.slot0[17]).toBeGreaterThan(0);
  });

  it("non-black smoke render heuristic from packed demo frame", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "reef_lagoon", seed: "1204" }));
    const packed = sim.advance({ ...buildIdleVizFrame(2), demo: true });
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

  it("survives 20x teardown without losing preset options", () => {
    const sim = new AquariumSim(parseAquariumOptions({ preset: "night_reef", seed: "42" }));
    for (let i = 0; i < 20; i++) {
      sim.advance({ t: i * 0.5, dt: 0.016, audio: 0.1, talkers, packets: [], demo: false });
      sim.teardown();
    }
    sim.setOptions(parseAquariumOptions({ preset: "night_reef", seed: "42" }));
    const packed = sim.advance({ t: 1, dt: 0.016, audio: 0.1, talkers, packets: [], demo: true });
    expect(packed.slot0[0]).toBe(1);
    expect(sim.getOptions().preset).toBe("night_reef");
  });

  it("no per-frame allocation after warm-up", () => {
    const sim = new AquariumSim(parseAquariumOptions({ seed: "909" }));
    const frame = { t: 10, dt: 1 / 60, audio: 0.2, talkers, packets: [{ proto: "udp", size: 96, field: 0.3 }], demo: false };
    for (let i = 0; i < 8; i++) sim.advance({ ...frame, t: frame.t + i * 0.016 });
    expect(sim.isWarmed()).toBe(true);
    const s0 = sim.slot0;
    const s1 = sim.slot1;
    const s2 = sim.slot2;
    const scratch = sim.particleScratch;
    for (let i = 0; i < 24; i++) sim.advance({ ...frame, t: frame.t + i * 0.016 });
    expect(sim.slot0).toBe(s0);
    expect(sim.slot1).toBe(s1);
    expect(sim.slot2).toBe(s2);
    expect(sim.particleScratch).toBe(scratch);
  });
});
