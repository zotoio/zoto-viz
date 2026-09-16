import { describe, expect, it } from "vitest";
import type { StateMsg } from "../core/types";
import {
  VIZ_DEFAULT_MAX_BUFFERS,
  VIZ_FRAME_BUDGET_MS,
  VizBufferWriter,
  buildVizFrame,
  defaultVizContract,
  parseVizContract,
  pluginNeedsVizContract,
} from "./viz-host";

describe("viz contract", () => {
  it("requires graphWalk false in schema parse", () => {
    expect(parseVizContract({ graphWalk: false })).toBeDefined();
    expect(parseVizContract({ graphWalk: true })).toBeUndefined();
    expect(parseVizContract(undefined)).toBeUndefined();
  });

  it("clamps buffer and particle caps", () => {
    const c = parseVizContract({
      graphWalk: false,
      maxBuffers: 99,
      maxBufferFloats: 4,
      maxParticles: 99999,
    });
    expect(c?.maxBuffers).toBe(8);
    expect(c?.maxBufferFloats).toBe(4);
    expect(c?.maxParticles).toBe(8192);
  });

  it("detects viz capabilities", () => {
    expect(pluginNeedsVizContract(["viz.read"])).toBe(true);
    expect(pluginNeedsVizContract(["graph.read"])).toBe(false);
  });

  it("exposes the frame budget constant", () => {
    expect(VIZ_FRAME_BUDGET_MS).toBeCloseTo(16.7, 1);
    expect(defaultVizContract().maxBuffers).toBe(VIZ_DEFAULT_MAX_BUFFERS);
  });
});

describe("VizBufferWriter", () => {
  const contract = defaultVizContract({ maxBuffers: 2, maxBufferFloats: 8, maxParticles: 4 });

  it("rejects out-of-range buffer slots", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeBuffer(-1, [1]).ok).toBe(false);
    expect(w.writeBuffer(2, [1]).ok).toBe(false);
    expect(w.writeBuffer(0, [1, 2, 3]).ok).toBe(true);
  });

  it("rejects buffer writes over maxBufferFloats", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeBuffer(0, new Array(9).fill(0)).ok).toBe(false);
    expect(w.writeBuffer(0, new Array(8).fill(0)).ok).toBe(true);
  });

  it("enforces particle cap", () => {
    const w = new VizBufferWriter(contract);
    expect(w.writeParticles(new Array(20).fill(0), 4).ok).toBe(false);
    expect(w.writeParticles(new Array(16).fill(0), 4).ok).toBe(true);
    expect(w.writeParticles(new Array(4).fill(0), 4).written).toBe(1);
  });

  it("rejects particles when maxParticles is 0", () => {
    const w = new VizBufferWriter(defaultVizContract({ maxParticles: 0 }));
    expect(w.writeParticles([0, 0, 0, 0]).ok).toBe(false);
  });

  it("validates uniform contract", () => {
    const w = new VizBufferWriter(defaultVizContract({ uniforms: ["uBright", "uAccent"] }));
    expect(w.writeUniform("uMode", 1).ok).toBe(false);
    expect(w.writeUniform("uBright", 0.5).ok).toBe(true);
    expect(w.writeUniform("uAccent", [1, 0, 0]).ok).toBe(true);
    expect(w.writeUniform("uAccent", 1).ok).toBe(false);
  });
});

describe("buildVizFrame", () => {
  it("decimates state without full graph walk", () => {
    const state: StateMsg = {
      type: "state",
      ts: 100,
      iface: "wlan0",
      interfaces: [],
      network: "192.168.1.0/24",
      local_ip: "192.168.1.2",
      gateway: "192.168.1.1",
      uptime: 10,
      stats: {
        pps: 10,
        bps: 1000,
        devices: 2,
        online: 2,
        flows: 1,
        active_flows: 1,
        packets: 100,
        bytes: 1000,
      },
      devices: [
        {
          ip: "192.168.1.3", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
          ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "lan", online: true,
          packets: 50, bytes_in: 1, bytes_out: 1,
        },
        {
          ip: "192.168.1.4", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [],
          ifaces: [], aliases: [], first_seen: 0, last_seen: 0, role: "internet", online: true,
          packets: 10, bytes_in: 1, bytes_out: 1,
        },
      ],
      flows: [
        { a: "192.168.1.3", b: "8.8.8.8", bytes: 100, packets: 80, ports: [], protos: ["tcp"], ifaces: [], first_seen: 0, last_seen: 0, rate: 1 },
        { a: "192.168.1.4", b: "1.1.1.1", bytes: 20, packets: 20, ports: [], protos: ["udp"], ifaces: [], first_seen: 0, last_seen: 0, rate: 1 },
      ],
    };
    const frame = buildVizFrame(state, 99, 0.2);
    expect(frame.t).toBe(100);
    expect(frame.dt).toBe(1);
    expect(frame.audio).toBe(0.2);
    expect(frame.packets).toHaveLength(2);
    expect(frame.talkers[0]?.id).toBe("192.168.1.3");
    expect(frame.talkers.length).toBeLessThanOrEqual(24);
  });
});
