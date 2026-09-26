import { beforeEach, describe, expect, it } from "vitest";
import FRAG from "../../../plugins/src/metro-lines/sky/fragment.glsl?raw";
import PLUGIN from "../../../plugins/src/metro-lines/plugin.yml?raw";
import VIS from "../../../plugins/src/metro-lines/visualisation.yml?raw";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import type { VizDataFrame } from "./viz-host";
import {
  METRO_DEFAULTS,
  METRO_FAIL_RGB,
  METRO_MAX_EDGES,
  METRO_MAX_STATIONS,
  METRO_MAX_TRAINS,
  METRO_MARK,
  METRO_SYS_FAIL_BANNER,
  METRO_TRADEMARK_DENY,
  METRO_WORK_BUDGET,
  MetroSim,
  acquireMetroSim,
  buildMetroNetwork,
  buildTicker,
  fictionalLabel,
  isMetroDemoFrame,
  metroWorkCounts,
  packMetroSlots,
  parseMetroOptions,
  releaseMetroSim,
  resetMetroHostRegistry,
  scanMetroTrademarks,
} from "../../../plugins/src/metro-lines/frontend/metro";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

const PRESETS = ["classic_map", "night_network", "disruptions_only", "minimal"] as const;

function liveFrame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return {
    t: 0,
    dt: 1 / 60,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [],
    headlines: [],
    ...over,
  };
}

describe("metro-lines pack", () => {
  beforeEach(() => {
    resetMetroHostRegistry();
    releaseMetroSim();
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
    expect(net.stations.length).toBeGreaterThanOrEqual(4);
    expect(net.edges.length).toBeGreaterThan(0);
    expect(net.legend[0]?.label).toBe("schematic");
    expect(net.ticker.toLowerCase()).toContain("demo");
  });

  it("live-shaped frames show stations and schematic lines", () => {
    const net = buildMetroNetwork(liveFrame({
      talkers: [
        { id: "10.1.1.10", rate: 120, role: "gateway" },
        { id: "10.1.1.20", rate: 90, role: "lan" },
        { id: "10.1.1.30", rate: 70, role: "lan" },
      ],
      packets: [
        { proto: "tcp", size: 400, field: 0.4 },
        { proto: "udp", size: 120, field: 0.2 },
      ],
    }), parseMetroOptions({ seed: "42" }));
    expect(net.stations.length).toBe(3);
    expect(net.edges.length).toBeGreaterThanOrEqual(2);
    expect(net.legend[0]?.label).toBe("schematic");
  });

  it("reordering talkers keeps stations keyed by id", () => {
    const opts = parseMetroOptions({ seed: "777" });
    const talkers = [
      { id: "host-a", rate: 100, role: "lan" },
      { id: "host-b", rate: 90, role: "lan" },
      { id: "host-c", rate: 80, role: "gateway" },
    ];
    const base = liveFrame({
      talkers,
      packets: [{ proto: "tcp", size: 200, field: 0.1 }],
    });
    const sim = new MetroSim();
    const net1 = sim.runtime.tick(base, opts);
    const net2 = sim.runtime.tick({ ...base, talkers: [...talkers].reverse() }, opts);
    for (const id of ["host-a", "host-b", "host-c"]) {
      const s1 = net1.stations.find((s) => s.id === id);
      const s2 = net2.stations.find((s) => s.id === id);
      expect(s1?.label).toBe(fictionalLabel(id));
      expect(s2?.label).toBe(s1?.label);
      expect(s2?.tx).toBe(s1?.tx);
      expect(s2?.slot).toBe(s1?.slot);
    }
  });

  it("headline with down does not create disruption on healthy sys", () => {
    const tick = buildTicker(liveFrame({
      sys: { failed: 0 },
      headlines: [{ id: "1", label: "x", text: "Markets down sharply" }],
    }), false);
    expect(tick.banner).toBe(false);
    expect(tick.text).toContain("Markets down");
    expect(tick.text.toLowerCase()).not.toContain("disruption");
  });

  it("sys.failed over threshold shows network banner", () => {
    const tick = buildTicker(liveFrame({ sys: { failed: METRO_SYS_FAIL_BANNER + 0.1 } }), false);
    expect(tick.banner).toBe(true);
    expect(tick.text).toContain("NETWORK DISRUPTION");
    const net = buildMetroNetwork(liveFrame({
      sys: { failed: 0.5 },
      talkers: [{ id: "gw", rate: 100, role: "gateway" }],
    }), parseMetroOptions({}));
    expect(net.disruptions).toBe(1);
  });

  it("rebuilds once", () => {
    const sim = new MetroSim();
    const opts = parseMetroOptions({ seed: "1" });
    const talkers = [
      { id: "host-a", rate: 100, role: "gateway" },
      { id: "host-b", rate: 80, role: "lan" },
    ];
    const pkt = { proto: "tcp", size: 300, field: 0.5 };
    for (let i = 0; i < 8; i++) {
      sim.step(liveFrame({ t: i, talkers, packets: [pkt] }), opts);
    }
    const rebuilds = sim.runtime.structureRebuilds;
    expect(rebuilds).toBe(1);
    const allocs = sim.runtime.tickAllocs;
    for (let i = 0; i < 300; i++) {
      sim.step(liveFrame({
        t: 10 + i,
        talkers: [
          { id: "host-a", rate: 100 + i, role: "gateway" },
          { id: "host-b", rate: 80 + i * 0.5, role: "lan" },
        ],
        packets: [pkt, { proto: "udp", size: 100 + i, field: 0.2 }],
      }), opts);
    }
    expect(sim.runtime.structureRebuilds).toBe(rebuilds);
    expect(sim.runtime.tickAllocs).toBe(allocs);
  });

  it("300-frame golden-live keeps host cache and edgeWeights instances", () => {
    const sim = new MetroSim();
    const opts = parseMetroOptions({ seed: "4242" });
    const talkers = [
      { id: "10.1.1.10", rate: 120, role: "gateway" },
      { id: "10.1.1.20", rate: 90, role: "lan" },
      { id: "10.1.1.30", rate: 70, role: "lan" },
    ];
    const pkt = { proto: "tcp", size: 400, field: 0.4 };
    sim.step(liveFrame({ talkers, packets: [pkt] }), opts);
    const hostsRef = sim.runtime.hostCache.hosts;
    const mapRef = sim.runtime.hostCache.hostById;
    const weightsRef = sim.edgeWeights;
    for (let i = 0; i < 300; i++) {
      sim.step(liveFrame({
        t: i,
        talkers: [
          { id: "10.1.1.10", rate: 120 + i * 0.1, role: "gateway" },
          { id: "10.1.1.20", rate: 90 + i * 0.2, role: "lan" },
          { id: "10.1.1.30", rate: 70 + i * 0.15, role: "lan" },
        ],
        packets: [pkt, { proto: "udp", size: 100 + i, field: 0.2 }],
      }), opts);
    }
    expect(sim.runtime.hostCache.hosts).toBe(hostsRef);
    expect(sim.runtime.hostCache.hostById).toBe(mapRef);
    expect(sim.edgeWeights).toBe(weightsRef);
  });

  it("work budget stays under plugin caps for every preset", () => {
    const sim = new MetroSim();
    const frame = buildIdleVizFrame(8, 1 / 60);
    for (const preset of PRESETS) {
      const opts = parseMetroOptions({ preset });
      const net = sim.step(frame, opts);
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
    const opts = parseMetroOptions({ seed: String(METRO_DEFAULTS.seed) });
    const net = sim.step(frame, opts);
    const slots = packMetroSlots(frame, net, opts, sim, { w: 1280, h: 800 });
    for (const s of slots) {
      expect(s.length).toBeLessThanOrEqual(64);
    }
    expect(slots[0]![0]).toBe(METRO_MARK);
    expect(net.stations.length).toBeLessThanOrEqual(METRO_MAX_STATIONS);
    expect(net.edges.length).toBeLessThanOrEqual(METRO_MAX_EDGES);
  });

  it("teardown frees sim subscriptions after 20 switches", () => {
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
    const net = sim.step(frame, parseMetroOptions({}));
    const slots = packMetroSlots(frame, net, parseMetroOptions({}), sim, { w: 640, h: 400 });
    expect(slots[0]![11]).toBeGreaterThan(0);
    expect(slots[0]![12]).toBeGreaterThan(0);
    for (const slot of slots) {
      for (const v of slot) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
