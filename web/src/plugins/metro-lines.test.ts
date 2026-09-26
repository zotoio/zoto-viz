import { describe, expect, it } from "vitest";
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
  metroWorkCounts,
  packMetroSlots,
  parseMetroOptions,
  releaseMetroSim,
  scanMetroTrademarks,
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
    const frame = emptyFrame(1);
    const a = buildMetroNetwork({ ...frame, talkers: buildIdleVizFrame(0).talkers }, parseMetroOptions({ seed: "100" }));
    const b = buildMetroNetwork({ ...frame, talkers: buildIdleVizFrame(0).talkers }, parseMetroOptions({ seed: "100" }));
    expect(a.stations.map((s) => [s.tx, s.ty])).toEqual(b.stations.map((s) => [s.tx, s.ty]));
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
