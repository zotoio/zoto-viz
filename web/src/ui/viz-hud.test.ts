import { describe, expect, it } from "vitest";
import type { StateMsg } from "../core/types";
import {
  VizHud,
  estimateTalkerParticles,
  formatSkipRate,
  isSkipPulsing,
  isVizDemoPack,
  skipRatePerSec,
  vizHudMetric,
} from "./viz-hud";

describe("viz hud helpers", () => {
  it("recognises demo pack ids", () => {
    expect(isVizDemoPack("packet-tunnel")).toBe(true);
    expect(isVizDemoPack("topology")).toBe(false);
  });

  it("computes rolling skip rate over ~1 s", () => {
    const now = 5000;
    const samples = [
      { t: 4200, n: 2 },
      { t: 4600, n: 1 },
      { t: 1000, n: 9 },
    ];
    expect(skipRatePerSec(samples, now)).toBeCloseTo(3.75, 1);
    expect(formatSkipRate(0)).toBe("skips 0/s");
    expect(formatSkipRate(2.4)).toBe("skips 2.4/s");
    expect(formatSkipRate(12.7)).toBe("skips 13/s");
  });

  it("flags skip pulse for ~400 ms after a skip", () => {
    const start = 1000;
    expect(isSkipPulsing(start, start + 400)).toBe(true);
    expect(isSkipPulsing(start + 200, start + 400)).toBe(true);
    expect(isSkipPulsing(start + 500, start + 400)).toBe(false);
  });

  it("lays out pack, metric, skip, and swap on one nowrap row", () => {
    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    hud.setActive("packet-tunnel", "Packet Tunnel");
    hud.tick({
      packId: "packet-tunnel",
      packName: "Packet Tunnel",
      stats: { skipped: 0, overBudget: 0, lastMs: 0, total: 0 },
      frame: null,
      state: minimalState(),
      now: 1000,
    });

    const line = hud.root.querySelector(".viz-hud-line");
    expect(line?.className).toBe("viz-hud-line");
    expect(hud.root.querySelector(".viz-hud-metric-value")?.textContent).toBe("3");
    expect(hud.root.querySelector(".viz-hud-skip")?.textContent).toBe("skips 0/s");
    expect(hud.root.querySelectorAll(".viz-hud-swap-btn")).toHaveLength(3);
    expect(hud.root.querySelector(".viz-hud-swap")?.parentElement).toBe(line);
  });

  it("caps talker particle estimate at 512", () => {
    const talkers = Array.from({ length: 200 }, (_, i) => ({
      id: `10.0.0.${i}`,
      rate: 400,
      role: "lan",
    }));
    expect(estimateTalkerParticles(talkers)).toBe(512);
  });

  it("picks pack-specific metrics from host state", () => {
    const state = minimalState();
    expect(vizHudMetric("packet-tunnel", null, state)).toEqual({ label: "flows", value: "3" });
    expect(vizHudMetric("rf-constellation", { t: 0, dt: 0, audio: 0, packets: [], rf: [{ ssid: "a", rssi: 0.5, channel: 6 }], talkers: [] }, state))
      .toEqual({ label: "RF", value: "1" });
    expect(vizHudMetric("talker-storm", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "particles", value: "2" });
  });
});

function minimalState(): StateMsg {
  return {
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
      flows: 5,
      active_flows: 3,
      packets: 100,
      bytes: 1000,
    },
    devices: [],
    flows: [],
  };
}
