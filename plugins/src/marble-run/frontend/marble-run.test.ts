import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { CONSERVATIVE_WORK_BUDGET } from "../../../sdk/host-init-context";
import { clampManifestWorkBudgetToCeilings } from "../../../sdk/manifest-work-budget";
import ceilings from "../../../../service/policy/work-budget-ceilings.json";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../sdk/viz-contract";
import {
  MARBLE_DATA_MAPPING,
  MARBLE_DEFAULTS,
  hash01,
  parseMarbleOptions,
} from "./config";
import {
  applyPackWorkBudget,
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
  parseMarbleWorkBudgetYaml,
  resetPackWorkBudget,
  setMarbleOptions,
  workWithinBudget,
  MR_SLOT,
  MR_SLOT0,
  MR_MARBLES_PER_SLOT,
  MR_MARBLE_FLOATS,
} from "./pack";
import { jarIndexForRouteKey, MarbleSim, SIM_DT, trackPieceCount } from "./sim";
import { probePluginSkyCompile, wrapPluginSky } from "./sky-probe";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(frontendDir, "..");
const FRAG = readFileSync(path.join(packRoot, "sky/fragment.glsl"), "utf8");
const PLUGIN = readFileSync(path.join(packRoot, "plugin.yml"), "utf8");
const VIS = readFileSync(path.join(packRoot, "visualisation.yml"), "utf8");

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

function shippedWorkBudget() {
  return parseMarbleWorkBudgetYaml(VIS);
}

describe("marble-run shipped pack", () => {
  beforeEach(() => {
    disposeMarblePack();
    resetPackWorkBudget();
    applyPackWorkBudget(shippedWorkBudget());
  });

  it("declares mapping, work budget in yaml, and compiles sky", () => {
    expect(PLUGIN).toContain("id: marble-run");
    expect(VIS).toMatch(/workBudget/);
    expect(VIS).toMatch(/dataMapping/);
    expect(MARBLE_DATA_MAPPING.length).toBe(4);
    const fromYaml = parseMarbleWorkBudgetYaml(VIS);
    expect(fromYaml).toEqual(marbleWorkBudget());
    expect(fromYaml.maxPacketsPerFrame).toBe(8);
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}`.toLowerCase();
    for (const mark of TRADEMARKS) expect(blob.includes(mark)).toBe(false);
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("is deterministic for pinned seed and preset", () => {
    const o = parseMarbleOptions({ preset: "workshop", seed: "4242" });
    const a = marbleDeterminismDigest(3.5, o);
    const b = marbleDeterminismDigest(3.5, o);
    expect(a).toBe(b);
    const c = marbleDeterminismDigest(3.5, { ...o, seed: 8801 });
    expect(c).not.toBe(a);
  });

  it("600-frame row: integrate runs exactly maxSimStepsPerFrame per frame on ingest path", () => {
    resetPackWorkBudget();
    expect(marbleWorkBudget()).toEqual(CONSERVATIVE_WORK_BUDGET);
    ingestFrame(liveFrame({ dt: 0.25 }));
    expect(marbleSim().integrateStepsLastFrame()).toBe(CONSERVATIVE_WORK_BUDGET.maxSimStepsPerFrame);

    const hostDelivers = clampManifestWorkBudgetToCeilings(
      { ...shippedWorkBudget(), maxSimStepsPerFrame: 99 },
      ceilings,
    );
    applyPackWorkBudget(hostDelivers);
    expect(marbleWorkBudget().maxSimStepsPerFrame).toBe(4);

    const steps: number[] = [];
    for (let i = 0; i < 600; i++) {
      ingestFrame({
        ...liveFrame(),
        t: i * 0.016,
        dt: 0.25,
        demo: true,
      });
      steps.push(marbleSim().integrateStepsLastFrame());
    }
    expect(steps).toEqual(Array(600).fill(4));
  });

  it("caps live packets at maxPacketsPerFrame with exact consumed and HUD skip counts", () => {
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "48" }));
    const cap = marbleWorkBudget().maxPacketsPerFrame;
    const packets = Array.from({ length: 500 }, (_, i) => ({
      proto: `p${i % 17}`,
      size: 64 + (i % 200),
      field: (i % 100) / 100,
    }));
    ingestFrame(liveFrame({ t: 0, dt: 0, demo: false, packets }));
    expect(marbleIngestStats().consumedPackets).toBe(8);
    expect(marbleHudSkipCount()).toBe(492);
    expect(marbleSim().bodies().filter((m) => m.active).length).toBe(8);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 0, demo: false }));
    expect(slot0[MR_SLOT.hudSkip]).toBe(492);
  });

  it("demo frames never leave the board blank while marbles are in flight", () => {
    setMarbleOptions(MARBLE_DEFAULTS);
    let peakActive = 0;
    let peakSlotEnergy = 0;
    for (let i = 0; i < 240; i++) {
      const t = i * SIM_DT;
      ingestFrame(liveFrame({ t, demo: true }));
      const { slot0, slot1 } = packMarbleSlots(liveFrame({ t, demo: true }));
      expect(slot0[MR_SLOT.mark]).toBe(1);
      const active = slot0[MR_SLOT.activeCount]!;
      peakActive = Math.max(peakActive, active);
      const slotEnergy = slot1.reduce((s, v) => s + Math.abs(v), 0);
      peakSlotEnergy = Math.max(peakSlotEnergy, slotEnergy);
      if (active > 0) {
        expect(slotEnergy).toBeGreaterThan(0);
      }
    }
    expect(peakActive).toBeGreaterThan(0);
    expect(peakSlotEnergy).toBeGreaterThan(0);
    const { slot0 } = packMarbleSlots(liveFrame({ t: 240 * SIM_DT, demo: true }));
    expect(slot0[MR_SLOT.demo]).toBe(1);
    const headerSum = slot0.reduce((s, v) => s + Math.abs(v), 0);
    expect(headerSum).toBeGreaterThan(2);
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
      expect(trackPieceCount(o.complexity, o.seed)).toBeLessThan(30);
    }
  });

  it("live packets spawn visible marbles; failure path lights reject glow", () => {
    setMarbleOptions(parseMarbleOptions({ destField: "proto", failThreshold: "0.5" }));
    ingestFrame(liveFrame({
      t: 1,
      demo: false,
      packets: [
        { proto: "tcp", size: 400, field: 0.62 },
        { proto: "udp", size: 96, field: 0.38 },
      ],
    }));
    expect(marbleSim().bodies().filter((m) => m.active).length).toBe(2);

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

    const frame = liveFrame({
      t: 1,
      demo: false,
      packets: [{ proto: "tcp", size: 64, field: 0.05 }],
      sys: { ...EMPTY_SYS_TELEMETRY, failed: 0.1 },
    });
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ failThreshold: "0.8" }));
    ingestFrame(frame);
    expect(isFrameFailed(frame, parseMarbleOptions({ failThreshold: "0.8" }))).toBe(false);
  });

  it("stable jar routing and protocol hue", () => {
    const o = parseMarbleOptions({ jarCount: "6", destField: "proto" });
    const proto = "dns";
    const jar = jarIndexForRouteKey(jarRouteKey({ proto, size: 1, field: 0.5 }, o), o.jarCount);
    setMarbleOptions(o);
    ingestFrame(liveFrame({ t: 0, demo: false, packets: [{ proto, size: 200, field: 0.6 }] }));
    expect(marbleSim().bodies().find((m) => m.active)?.jar).toBe(jar);
    const pkt = { proto: "tls", size: 1, field: 0.5 };
    expect(marbleHueForPacket(pkt)).toBe(hash01("tls"));
  });

  it("fixed timestep sim respects catch-up cap from work budget", () => {
    const sim = new MarbleSim(parseMarbleOptions({ maxMarbles: "16" }));
    sim.stepFrame(0.5);
    expect(sim.integrateStepsLastFrame()).toBe(4);
    sim.dispose();
  });

  it("packs slot geometry contract", () => {
    setMarbleOptions(MARBLE_DEFAULTS);
    const { slot0, slot1 } = packMarbleSlots(liveFrame({ t: 0, demo: true }));
    expect(slot0.length).toBe(MR_SLOT0);
    expect(slot1.length).toBe(MR_MARBLES_PER_SLOT * MR_MARBLE_FLOATS);
  });
});
