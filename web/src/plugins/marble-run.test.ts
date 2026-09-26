import { beforeEach, describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/marble-run/sky/fragment.glsl?raw";
import VIS from "../../../plugins/src/marble-run/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/marble-run/plugin.yml?raw";
import {
  MARBLE_DATA_MAPPING,
  MARBLE_DEFAULTS,
  hash01,
  parseMarbleOptions,
} from "../../../plugins/src/marble-run/frontend/config";
import {
  disposeMarblePack,
  ingestFrame,
  isFrameFailed,
  jarRouteKey,
  marbleDeterminismDigest,
  marbleHueForPacket,
  marbleHudSkipCount,
  marbleIngestStats,
  marbleSim,
  marbleWorkBudget,
  packMarbleSlots,
  setMarbleWorkBudgetFromHost,
  setMarbleOptions,
  workWithinBudget,
  MR_SLOT,
  MR_SLOT0,
  MR_MARBLES_PER_SLOT,
  MR_MARBLE_FLOATS,
} from "../../../plugins/src/marble-run/frontend/pack";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { jarIndexForRouteKey, MarbleSim, SIM_DT, trackPieceCount } from "../../../plugins/src/marble-run/frontend/sim";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { toPluginView } from "./plugin-visualisation";
import { applyPluginViewWorkBudget } from "./manifest-work-budget-host";
import { hostWorkBudgetCeilings } from "./work-budget-policy";
import { parseVizContract } from "./viz-host";

const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix"];

function liveFrame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return {
    t: 0,
    dt: SIM_DT,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
    sys: { ...EMPTY_SYS_TELEMETRY, failed: 0 },
    ...over,
  };
}

describe("marble-run pack", () => {
  beforeEach(() => {
    setMarbleWorkBudgetFromHost(hostWorkBudgetCeilings());
  });

  it("validates plugin.yml viz contract and catalog row", () => {
    const contract = parseVizContract({
      graphWalk: false,
      maxBuffers: 4,
      maxBufferFloats: 64,
      maxParticles: 0,
      uniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"],
      idle: { fixture: "host" },
    });
    expect(contract?.maxBuffers).toBe(4);
    const view = toPluginView({
      id: "marble-run",
      name: "Marble Run",
      version: 1,
      capabilities: ["viz.read", "viz.write", "config.read"],
      viz: {
        graphWalk: false,
        maxBuffers: 4,
        maxBufferFloats: 64,
        maxParticles: 0,
        idle: { fixture: "host" },
      },
      visualisation: {
        engine: "graph",
        base: "protocols",
        idle: { fixture: "host" },
        config: [
          { key: "preset", label: "preset", type: "select", default: "workshop", values: [["workshop", "Workshop"]] },
        ],
      },
    });
    expect(view.id).toBe("marble-run");
    expect(view.config?.length).toBeGreaterThan(0);
    expect(view.viz?.idle).toEqual({ fixture: "host" });
  });

  it("declares presets, mapping, and work budget in shipped yaml", () => {
    expect(VIS).toMatch(/preset/);
    expect(VIS).toMatch(/workshop/);
    expect(VIS).toMatch(/glass-tower/);
    expect(VIS).toMatch(/chaos-funnel/);
    expect(VIS).toMatch(/calm-spiral/);
    expect(VIS).toMatch(/dataMapping/);
    expect(VIS).toMatch(/workBudget/);
    expect(VIS).not.toMatch(/colorField/);
    expect(VIS).not.toMatch(/talker/);
    expect(MARBLE_DATA_MAPPING.length).toBe(4);
    expect(VIS).toMatch(/maxInstances: 48/);
    const view = toPluginView({
      id: "marble-run",
      name: "Marble Run",
      version: 1,
      visualisation: {
        engine: "graph",
        base: "protocols",
        workBudget: hostWorkBudgetCeilings(),
      },
    });
    applyPluginViewWorkBudget(view);
    expect(marbleWorkBudget().maxInstances).toBe(48);
    expect(marbleWorkBudget().maxPacketsPerFrame).toBe(8);
  });

  it("passes trademark name check on pack text", () => {
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}`.toLowerCase();
    for (const mark of TRADEMARKS) {
      expect(blob.includes(mark)).toBe(false);
    }
  });

  it("wraps and compiles the sky shader", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("clamps options from config.read strings only", () => {
    const o = parseMarbleOptions({
      preset: "calm-spiral",
      seed: "9999999",
      complexity: "9",
      maxMarbles: "100",
      jarCount: "2",
      failThreshold: "2",
      destField: "talker",
      colorField: "service",
    });
    expect(o.preset).toBe("calm-spiral");
    expect(o.seed).toBe(999_999);
    expect(o.complexity).toBe(5);
    expect(o.maxMarbles).toBe(48);
    expect(o.jarCount).toBe(3);
    expect(o.failThreshold).toBe(0.95);
    expect(o.destField).toBe("proto");
  });

  it("keeps work counts under caps for every preset at pinned seed", () => {
    const presets = ["workshop", "glass-tower", "chaos-funnel", "calm-spiral"] as const;
    for (const preset of presets) {
      disposeMarblePack();
      const o = parseMarbleOptions({ preset, seed: "4242", complexity: "5", maxMarbles: "48" });
      setMarbleOptions(o);
      for (let i = 0; i < 240; i++) {
        ingestFrame(liveFrame({
          t: i * SIM_DT,
          demo: true,
          packets: [{ proto: "tcp", size: 900, field: 0.7 }],
        }));
      }
      expect(workWithinBudget(o)).toBe(true);
      const pieces = trackPieceCount(o.complexity, o.seed);
      expect(pieces).toBeLessThan(30);
    }
  });

  it("is deterministic for pinned seed and preset", () => {
    const o = parseMarbleOptions({ preset: "workshop", seed: "4242" });
    const a = marbleDeterminismDigest(3.5, o);
    const b = marbleDeterminismDigest(3.5, o);
    expect(a).toBe(b);
    const c = marbleDeterminismDigest(3.5, { ...o, seed: 8801 });
    expect(c).not.toBe(a);
  });

  it("uses fixed timestep with catch-up cap from workBudget", () => {
    const sim = new MarbleSim(parseMarbleOptions({ maxMarbles: "16" }));
    sim.stepFrame(0.5);
    expect(marbleWorkBudget().maxSimStepsPerFrame).toBe(4);
    sim.dispose();
  });

  it("packs non-black scene header and demo label path", () => {
    disposeMarblePack();
    setMarbleOptions(MARBLE_DEFAULTS);
    ingestFrame(liveFrame({ t: 2, demo: true }));
    const { slot0 } = packMarbleSlots(liveFrame({ t: 2, demo: true }));
    expect(slot0[0]).toBe(1);
    expect(slot0.length).toBe(MR_SLOT0);
    expect(slot0[21]).toBe(1);
    expect(slot0[28]).toBeGreaterThan(0.9);
    const sum = slot0.reduce((s, v) => s + Math.abs(v), 0);
    expect(sum).toBeGreaterThan(2);
  });

  it("live-shaped frames spawn visible marbles and jar state", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ destField: "proto" }));
    ingestFrame(liveFrame({
      t: 1,
      demo: false,
      packets: [
        { proto: "tcp", size: 400, field: 0.62 },
        { proto: "udp", size: 96, field: 0.38 },
      ],
    }));
    expect(marbleSim().bodies().filter((m) => m.active).length).toBe(2);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 1, demo: false }));
    expect(slot0[MR_SLOT.activeCount]).toBe(2);
    const jarSum = slot0.slice(MR_SLOT.jar0, MR_SLOT.jar0 + 8).reduce((a, b) => a + b, 0);
    expect(jarSum).toBeGreaterThan(0);
  });

  it("does not reject healthy packets with low field values", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ failThreshold: "0.8" }));
    const frame = liveFrame({
      t: 1,
      demo: false,
      packets: [{ proto: "tcp", size: 64, field: 0.05 }],
      sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.1 },
    });
    ingestFrame(frame);
    expect(marbleSim().bodies().some((m) => m.active && m.failed)).toBe(false);
    expect(isFrameFailed(frame, parseMarbleOptions({ failThreshold: "0.8" }))).toBe(false);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 1, demo: false }));
    expect(slot0[MR_SLOT.rejectGlow]).toBeLessThan(0.5);
  });

  it("sends marbles to the reject tray when sys.failed is over threshold", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ failThreshold: "0.5" }));
    ingestFrame(liveFrame({
      t: 1,
      demo: false,
      packets: [{ proto: "tcp", size: 400, field: 0.9 }],
      sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.9 },
    }));
    expect(marbleSim().bodies().some((m) => m.active && m.failed)).toBe(true);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 1, demo: false }));
    expect(slot0[MR_SLOT.rejectGlow]).toBeGreaterThan(0.7);
  });

  it("colours marbles from protocol hash only", () => {
    const pkt = { proto: "tls", size: 1, field: 0.5 };
    expect(marbleHueForPacket(pkt)).toBe(hash01("tls"));
    expect(marbleHueForPacket({ proto: "tcp", size: 1, field: 0.5 })).not.toBe(marbleHueForPacket(pkt));
  });

  it("caps contract frames at workBudget maxPacketsPerFrame and accumulates HUD skips", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "48" }));
    const cap = marbleWorkBudget().maxPacketsPerFrame;
    const packets = Array.from({ length: cap + 5 }, (_, i) => ({
      proto: i % 2 ? "udp" : "tcp",
      size: 80 + i,
      field: 0.4,
    }));
    ingestFrame(liveFrame({ t: 0, demo: false, packets }));
    const stats = marbleIngestStats();
    expect(stats.consumedPackets).toBe(cap);
    expect(stats.poolFull).toBe(0);
    expect(marbleHudSkipCount()).toBe(5);
    expect(marbleSim().bodies().filter((m) => m.active).length).toBe(cap);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 0, demo: false }));
    expect(slot0[MR_SLOT.hudSkip]).toBe(5);
  });

  it("ingests 500-packet frame with at most eight spawns and +492 HUD skips without reallocating pools", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "48" }));
    const sim = marbleSim();
    const poolBefore = sim.bodies();
    const { slot0: slot0Before, slot1: slot1Before } = packMarbleSlots(liveFrame({ t: 0, demo: false }));
    const packets = Array.from({ length: 500 }, (_, i) => ({
      proto: `p${i % 17}`,
      size: 64 + (i % 200),
      field: (i % 100) / 100,
    }));
    ingestFrame(liveFrame({ t: 0, dt: 0, demo: false, packets }));
    expect(marbleSim().bodies()).toBe(poolBefore);
    expect(marbleSim().bodies().filter((m) => m.active).length).toBeLessThanOrEqual(8);
    expect(marbleHudSkipCount()).toBe(492);
    expect(marbleIngestStats().consumedPackets).toBe(8);
    const { slot0, slot1 } = packMarbleSlots(liveFrame({ t: 0, demo: false }));
    expect(slot0.length).toBe(slot0Before.length);
    expect(slot1.length).toBe(slot1Before.length);
    expect(slot0.length).toBe(MR_SLOT0);
    expect(slot1.length).toBe(MR_MARBLES_PER_SLOT * MR_MARBLE_FLOATS);
    expect(slot0[MR_SLOT.hudSkip]).toBe(492);
  });

  it("keeps the same jar for a proto when talkers are reordered", () => {
    const o = parseMarbleOptions({ jarCount: "6", destField: "proto" });
    const proto = "dns";
    const key = jarRouteKey({ proto, size: 1, field: 0.5 }, o);
    const jar = jarIndexForRouteKey(key, o.jarCount);
    disposeMarblePack();
    setMarbleOptions(o);
    ingestFrame(liveFrame({
      t: 0, demo: false,
      packets: [{ proto, size: 200, field: 0.6 }],
      talkers: [{ id: "10.0.0.1", rate: 1, role: "gateway" }, { id: "10.0.0.2", rate: 2, role: "lan" }],
    }));
    const jarA = marbleSim().bodies().find((m) => m.active)?.jar;
    disposeMarblePack();
    setMarbleOptions(o);
    ingestFrame(liveFrame({
      t: 0, demo: false,
      packets: [{ proto, size: 200, field: 0.6 }],
      talkers: [{ id: "10.0.0.2", rate: 2, role: "lan" }, { id: "10.0.0.1", rate: 1, role: "gateway" }],
    }));
    const jarB = marbleSim().bodies().find((m) => m.active)?.jar;
    expect(jarA).toBe(jar);
    expect(jarB).toBe(jar);
  });

  it("frees sim state after 20 pack teardown cycles", () => {
    for (let i = 0; i < 20; i++) {
      setMarbleOptions(parseMarbleOptions({ seed: String(1000 + i) }));
      ingestFrame(liveFrame({
        t: 0.1,
        demo: true,
        packets: [{ proto: "udp", size: 64, field: 0.4 }],
      }));
      disposeMarblePack();
    }
    disposeMarblePack();
    setMarbleOptions(MARBLE_DEFAULTS);
    const after = packMarbleSlots(liveFrame({ t: 0, demo: true }));
    expect(after.slot0[26]).toBe(0);
  });
});
