import { beforeEach, describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/metro-lines/sky/fragment.glsl?raw";
import PLUGIN from "../../../plugins/src/metro-lines/plugin.yml?raw";
import VIS from "../../../plugins/src/metro-lines/visualisation.yml?raw";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import {
  METRO_DEFAULTS,
  METRO_FAIL_RGB,
  METRO_MAX_EDGES,
  METRO_MAX_STATIONS,
  METRO_MAX_TRAINS,
  METRO_MARK,
  METRO_TRADEMARK_DENY,
  METRO_WORK_BUDGET,
  MetroSim,
  acquireMetroSim,
  buildMetroNetwork,
  isMetroDemoFrame,
  metroStationStressPacked,
  metroWorkCounts,
  packMetroSlots,
  parseMetroOptions,
  releaseMetroSim,
  resetMetroHostRegistry,
  scanMetroTrademarks,
  fictionalLabel,
} from "../../../plugins/src/metro-lines/frontend/metro";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

const PRESETS = ["classic_map", "night_network", "disruptions_only", "minimal"] as const;

function emptyFrame(t = 0): ReturnType<typeof buildIdleVizFrame> {
  return {
    t,
    dt: 1 / 60,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
  };
}

describe("metro-lines pack", () => {
  beforeEach(() => {
    resetMetroHostRegistry();
  });

  it("wraps and compiles the schematic sky", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("validates presets and clamps options from config.read", () => {
    for (const preset of PRESETS) {
      const o = parseMetroOptions({ preset, maxStations: "99", maxTrains: "200", trainSpeed: "9" });
      expect(o.preset).toBe(preset);
      expect(o.maxStations).toBe(METRO_MAX_STATIONS);
      expect(o.maxTrains).toBe(METRO_MAX_TRAINS);
      expect(o.trainSpeed).toBe(3);
    }
    expect(parseMetroOptions({ seed: "4242" }).seed).toBe(4242);
  });

  it("name-check rejects real transit authority branding", () => {
    expect(scanMetroTrademarks("London Underground roundel")).toBeTruthy();
    expect(scanMetroTrademarks("Johnston font")).toBeTruthy();
    expect(scanMetroTrademarks("Amber Yard on the Cinder Loop")).toBeNull();
    for (const term of METRO_TRADEMARK_DENY) {
      expect(scanMetroTrademarks(`contains ${term} here`)).toBeTruthy();
    }
    expect(PLUGIN.toLowerCase()).not.toMatch(/johnston|underground roundel/);
    expect(VIS.toLowerCase()).not.toMatch(/transport for london/);
  });

  it("idle demo network is alive and labelled demo", () => {
    const frame = buildIdleVizFrame(4, 1 / 60);
    expect(isMetroDemoFrame(frame)).toBe(true);
    const net = buildMetroNetwork(frame, parseMetroOptions({ preset: "classic_map" }));
    expect(net.demo).toBe(true);
    expect(net.stations.length).toBeGreaterThanOrEqual(6);
    expect(net.edges.length).toBeGreaterThan(0);
    expect(net.ticker.toLowerCase()).toContain("demo");
  });

  it("deterministic layout for pinned seed", () => {
    const opts = parseMetroOptions({ seed: "100" });
    const talkers = [
      { id: "host-a", rate: 100, role: "lan" },
      { id: "host-b", rate: 90, role: "lan" },
    ];
    const frame = { ...emptyFrame(1), demo: false, talkers, packets: [] };
    const a = buildMetroNetwork(frame, opts);
    const b = buildMetroNetwork(frame, opts);
    expect(a.stations.find((s) => s.id === "host-a")?.tx)
      .toBe(b.stations.find((s) => s.id === "host-a")?.tx);
  });

  it("station ids, labels, and failures follow hosts when talkers reorder", () => {
    const opts = parseMetroOptions({ seed: "777", lineSource: "packets" });
    const talkers = [
      { id: "host-a", rate: 100, role: "lan" },
      { id: "host-b", rate: 90, role: "lan" },
      { id: "host-c", rate: 80, role: "gateway", failed: 0.85 },
    ];
    const packets = [
      { proto: "tcp", size: 200, field: 0.05, host: "host-a", peer: "host-c" },
      { proto: "tcp", size: 180, field: 0.04, host: "host-b", peer: "host-c" },
    ];
    const base = { ...emptyFrame(2), demo: false, sys: { failed: 0 }, packets };
    const net1 = buildMetroNetwork({ ...base, talkers }, opts);
    const net2 = buildMetroNetwork({ ...base, talkers: [...talkers].reverse() }, opts);
    for (const id of ["host-a", "host-b", "host-c"]) {
      const s1 = net1.stations.find((s) => s.id === id);
      const s2 = net2.stations.find((s) => s.id === id);
      expect(s1?.label).toBe(fictionalLabel(id));
      expect(s2?.label).toBe(s1?.label);
      expect(s2?.tx).toBe(s1?.tx);
      expect(s2?.failed).toBe(s1?.failed);
    }
    expect(net1.stations.find((s) => s.id === "host-c")?.failed).toBeCloseTo(0.85);
    expect(net1.stations.find((s) => s.id === "host-a")?.failed).toBe(0);
  });

  it("healthy low-field packets do not trigger failure visuals", () => {
    const opts = parseMetroOptions({ lineSource: "packets" });
    const talkers = [
      { id: "host-a", rate: 50, role: "lan" },
      { id: "host-b", rate: 40, role: "lan" },
    ];
    const packets = [
      { proto: "dns", size: 64, field: 0.01, host: "host-a", peer: "host-b" },
      { proto: "dns", size: 48, field: 0.02, host: "host-b", peer: "host-a" },
    ];
    const net = buildMetroNetwork({
      ...emptyFrame(3),
      demo: false,
      talkers,
      packets,
      sys: { failed: 0 },
    }, opts);
    expect(net.stations.every((s) => s.failed === 0)).toBe(true);
    expect(net.edges.every((e) => e.disrupted === 0)).toBe(true);
    expect(net.stations.every((s) => metroStationStressPacked(s) === 0)).toBe(true);
  });

  it("work budget stays under plugin caps for every preset", () => {
    const sim = new MetroSim();
    const frame = buildIdleVizFrame(8, 1 / 60);
    for (const preset of PRESETS) {
      const opts = parseMetroOptions({ preset });
      const net = buildMetroNetwork(frame, opts);
      sim.step(frame, net, opts);
      const w = metroWorkCounts(sim, net);
      expect(w.drawCalls).toBeLessThanOrEqual(METRO_WORK_BUDGET.drawCalls);
      expect(w.triangles).toBeLessThanOrEqual(METRO_WORK_BUDGET.triangles);
      expect(w.particles).toBeLessThanOrEqual(METRO_MAX_TRAINS);
      expect(w.allocatedGpuBytes).toBeLessThanOrEqual(METRO_WORK_BUDGET.gpuBytes);
    }
  });

  it("buffer slots respect maxBufferFloats and include mark", () => {
    const sim = new MetroSim();
    const frame = buildIdleVizFrame(2, 1 / 60);
    const opts = parseMetroOptions(METRO_DEFAULTS as unknown as Record<string, string>);
    const net = buildMetroNetwork(frame, opts);
    sim.step(frame, net, opts);
    const slots = packMetroSlots(frame, net, opts, sim, { w: 1280, h: 800 });
    for (const s of slots) {
      expect(s.length).toBeLessThanOrEqual(64);
    }
    expect(slots[0]![0]).toBe(METRO_MARK);
    expect(net.stations.length).toBeLessThanOrEqual(METRO_MAX_STATIONS);
    expect(net.edges.length).toBeLessThanOrEqual(METRO_MAX_EDGES);
  });

  it("teardown frees sim subscriptions after 20 switches", () => {
    resetMetroHostRegistry();
    for (let i = 0; i < 20; i++) {
      acquireMetroSim();
      releaseMetroSim();
    }
    acquireMetroSim();
    const sim = acquireMetroSim();
    expect(sim.activeSubscriptions).toBe(2);
    releaseMetroSim();
    releaseMetroSim();
    acquireMetroSim();
    releaseMetroSim();
  });

  it("fail colour constant matches shader Zoto Fail", () => {
    expect(METRO_FAIL_RGB[0]).toBeCloseTo(0.93, 2);
    expect(FRAG).toContain("0.93, 0.12, 0.35");
  });

  it("non-black smoke: packed header has finite geometry counts", () => {
    const sim = new MetroSim();
    const frame = buildIdleVizFrame(0.5, 1 / 60);
    const net = buildMetroNetwork(frame, parseMetroOptions({}));
    sim.step(frame, net, parseMetroOptions({}));
    const slots = packMetroSlots(frame, net, parseMetroOptions({}), sim, { w: 640, h: 400 });
    const nSta = slots[0]![11];
    const nEdge = slots[0]![12];
    expect(nSta).toBeGreaterThan(0);
    expect(nEdge).toBeGreaterThan(0);
    for (const slot of slots) {
      for (const v of slot) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
