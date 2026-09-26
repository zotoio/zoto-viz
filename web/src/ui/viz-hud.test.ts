import { describe, expect, it } from "vitest";
import type { StateMsg } from "../core/types";
import { protocols } from "../core/modes";
import { hudTickFromBudget } from "../plugins/dogfood-runner";
import { VizFrameBudget } from "../plugins/viz-host";
import {
  VizHud,
  estimateTalkerParticles,
  formatSkipRate,
  isSkipPulsing,
  isVizDemoPack,
  normalizeVizDemoPackId,
  skipRatePerSec,
  vizHudMetric,
} from "./viz-hud";
import { formatVizBudgetOverlay } from "../plugins/viz-budget-overlay";

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right">;

/** True when two axis-aligned boxes share interior area. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Models anchor-positioned HUD (`bottom: anchor(--viz-foot top); margin-bottom: 8px`). */
export function modeledHudFootBoxes(
  viewportH: number,
  footH: number,
  hudH: number,
  footBottom = 12,
  hudGap = 8,
): { foot: Box; hud: Box } {
  const footTop = viewportH - footBottom - footH;
  const hudBottom = footTop - hudGap;
  const hudTop = hudBottom - hudH;
  return {
    foot: { top: footTop, bottom: footTop + footH, left: 12, right: 920 },
    hud: { top: hudTop, bottom: hudBottom, left: 12, right: 480 },
  };
}

/** packet-tunnel base (protocols legend) @ 1280×800 — conservative lower bound from browser layout. */
const FAT_PROTOCOLS_FOOT_H = 72;
const HUD_LINE_H = 26;
const VIEWPORT_H = 800;

describe("viz hud helpers", () => {
  it("recognises demo pack ids", () => {
    expect(isVizDemoPack("packet-tunnel")).toBe(true);
    expect(isVizDemoPack("topology")).toBe(false);
  });

  it("normalises plugin view ids to bare demo pack ids", () => {
    expect(normalizeVizDemoPackId("plugin:packet-tunnel")).toBe("packet-tunnel");
    expect(normalizeVizDemoPackId("plugin:rf-constellation")).toBe("rf-constellation");
    expect(normalizeVizDemoPackId("plugin:talker-storm")).toBe("talker-storm");
    expect(normalizeVizDemoPackId("plugin:kefrens-bars")).toBe("kefrens-bars");
    expect(normalizeVizDemoPackId("plugin:topology")).toBeNull();
    expect(normalizeVizDemoPackId("topology")).toBeNull();
    expect(isVizDemoPack("plugin:packet-tunnel")).toBe(true);
  });

  it("unhides #viz-hud for plugin-prefixed demo pack ids", () => {
    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    expect(hud.root.hidden).toBe(true);
    hud.setActive("plugin:packet-tunnel", "Packet Tunnel");
    expect(hud.root.hidden).toBe(false);
    expect(hud.root.id).toBe("viz-hud");
  });

  it("computes rolling skip rate over ~1 s", () => {
    const now = 5000;
    const samples = [
      { t: 4200, n: 2 },
      { t: 4600, n: 1 },
      { t: 1000, n: 9 },
    ];
    expect(skipRatePerSec(samples, now)).toBeCloseTo(3, 1);
    expect(formatSkipRate(0)).toBe("skips 0/s");
    expect(formatSkipRate(2.4)).toBe("skips 2.4/s");
    expect(formatSkipRate(12.7)).toBe("skips 13/s");
  });

  it("does not inflate same-timestamp skip bursts", () => {
    const now = 5000;
    expect(skipRatePerSec([{ t: now, n: 23 }], now)).toBeCloseTo(23, 1);
  });

  it("reports steady skip rate spread across the window", () => {
    const now = 5000;
    const samples = [
      { t: 4100, n: 5 },
      { t: 4300, n: 5 },
      { t: 4500, n: 5 },
      { t: 4700, n: 5 },
    ];
    expect(skipRatePerSec(samples, now)).toBeCloseTo(20, 1);
  });

  it("returns zero for empty skip samples", () => {
    expect(skipRatePerSec([], 5000)).toBe(0);
  });

  it("records present-time skips after the second markPresent (soft FPS honesty)", () => {
    const budget = new VizFrameBudget();
    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    hud.setActive("rf-constellation", "RF Constellation");
    hud.tick(hudTickFromBudget("rf-constellation", "RF Constellation", minimalState(), budget, 1000));

    budget.markPresent(1000);
    budget.markPresent(1029);
    expect(budget.stats.skipped).toBeGreaterThanOrEqual(1);

    hud.tick(hudTickFromBudget("rf-constellation", "RF Constellation", minimalState(), budget, 1029));

    const skipText = hud.root.querySelector(".viz-hud-skip")?.textContent ?? "";
    expect(skipText).not.toBe("skips 0/s");
    expect(skipRatePerSec([{ t: 1029, n: budget.stats.skipped }], 1029)).toBeLessThanOrEqual(240);
  });

  it("syncs skip baseline on pack change without a false burst", () => {
    const budget = new VizFrameBudget();
    budget.markPresent(0);
    budget.markPresent(29);
    expect(budget.stats.skipped).toBe(1);

    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    hud.setActive("hn-term", "HN Term");
    hud.tick(hudTickFromBudget("hn-term", "HN Term", minimalState(), budget, 29));
    expect(hud.root.querySelector(".viz-hud-skip")?.textContent).toBe("skips 0/s");

    budget.markPresent(58);
    hud.tick(hudTickFromBudget("hn-term", "HN Term", minimalState(), budget, 58));
    const skipText = hud.root.querySelector(".viz-hud-skip")?.textContent ?? "";
    expect(skipText).not.toBe("skips 0/s");
    expect(skipRatePerSec([{ t: 58, n: 1 }], 58)).toBeLessThanOrEqual(240);
  });

  it("flags skip pulse for ~400 ms after a skip", () => {
    const start = 1000;
    expect(isSkipPulsing(start, start + 400)).toBe(true);
    expect(isSkipPulsing(start + 200, start + 400)).toBe(true);
    expect(isSkipPulsing(start + 500, start + 400)).toBe(false);
  });

  it("anchors HUD above #foot and keeps boxes clear under a fat protocols legend", () => {
    document.body.innerHTML = `
      <div id="scene"></div>
      <div id="foot"><div id="hint"></div><div id="legend"></div></div>
    `;
    const hint = document.getElementById("hint")!;
    const legend = document.getElementById("legend")!;
    hint.textContent = protocols.hint;
    for (const item of protocols.legend({})) {
      const s = document.createElement("span");
      const i = document.createElement("i");
      i.style.background = item.color;
      if (item.line) i.classList.add("line");
      s.append(i, item.label);
      legend.append(s);
    }

    const hud = new VizHud(document.getElementById("scene")!, () => {});
    hud.setActive("packet-tunnel", "Packet Tunnel");
    hud.root.hidden = false;

    const { foot, hud: hudBox } = modeledHudFootBoxes(VIEWPORT_H, FAT_PROTOCOLS_FOOT_H, HUD_LINE_H);
    expect(boxesOverlap(foot, hudBox)).toBe(false);
    expect(hudBox.bottom).toBeLessThanOrEqual(foot.top - 8);
    expect(legend.childElementCount).toBeGreaterThanOrEqual(10);
  });

  it("shows budget overlay with CPU label and dashes when there are no samples", () => {
    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    hud.setBudgetOverlayVisible(true);
    hud.setActive("packet-tunnel", "Packet Tunnel");
    hud.tick({
      packId: "packet-tunnel",
      packName: "Packet Tunnel",
      stats: {
        skipped: 0, overBudget: 0, lastMs: 0, p95Ms: 0, total: 0, timingSource: "cpu", hasSamples: false,
      },
      frame: null,
      state: minimalState(),
      now: 1000,
      renderScale: 1,
    });
    const text = hud.root.querySelector(".viz-hud-budget")?.textContent ?? "";
    expect(text).toBe(formatVizBudgetOverlay({
      timingSource: "cpu",
      lastMs: null,
      p95Ms: null,
      renderScale: 1,
    }));
    expect(text.startsWith("CPU")).toBe(true);
    expect(text).toContain("—");
  });

  it("lays out pack, metric, skip, and swap on one nowrap row", () => {
    const host = document.createElement("div");
    const hud = new VizHud(host, () => {});
    hud.setActive("packet-tunnel", "Packet Tunnel");
    hud.tick({
      packId: "packet-tunnel",
      packName: "Packet Tunnel",
      stats: {
        skipped: 0, overBudget: 0, lastMs: 0, p95Ms: 0, total: 0, timingSource: "cpu", hasSamples: false,
      },
      frame: null,
      state: minimalState(),
      now: 1000,
    });

    const line = hud.root.querySelector(".viz-hud-line");
    expect(line?.className).toBe("viz-hud-line");
    expect(hud.root.querySelector(".viz-hud-metric-value")?.textContent).toBe("3");
    expect(hud.root.querySelector(".viz-hud-skip")?.textContent).toBe("skips 0/s");
    expect(hud.root.querySelector(".viz-hud-swap .field.select")).toBeTruthy();
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

  it("shows demo metric value for idle-backed frames", () => {
    const state = minimalState();
    const idleFrame = {
      t: 0,
      dt: 0,
      audio: 0,
      demo: true,
      packets: [{ proto: "tcp", size: 1, field: 0.5 }],
      rf: [],
      talkers: [],
      headlines: [],
    };
    expect(vizHudMetric("packet-tunnel", idleFrame, state)).toEqual({ label: "flows", value: "demo" });
    expect(vizHudMetric("talker-storm", {
      ...idleFrame,
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "particles", value: "demo" });
  });

  it("shows demo only for the pack's idle-filled slice", () => {
    const state = minimalState();
    const mixed = {
      t: 0,
      dt: 0,
      audio: 0,
      demo: true,
      demoSlices: { rf: true as const, headlines: true as const },
      packets: [{ proto: "tcp", size: 1, field: 0.5 }],
      rf: [{ ssid: "demo", rssi: 0.4, channel: 1 }],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
      headlines: [{ id: "h1", label: "HN", text: "idle" }],
    };
    expect(vizHudMetric("packet-tunnel", mixed, state)).toEqual({ label: "flows", value: "3" });
    expect(vizHudMetric("talker-storm", mixed, state)).toEqual({ label: "particles", value: "2" });
    expect(vizHudMetric("rf-constellation", mixed, state)).toEqual({ label: "RF", value: "demo" });
    expect(vizHudMetric("hn-rain", mixed, state)).toEqual({ label: "headlines", value: "demo" });
  });

  it("picks pack-specific metrics from host state", () => {
    const state = minimalState();
    expect(vizHudMetric("packet-tunnel", null, state)).toEqual({ label: "flows", value: "3" });
    expect(vizHudMetric("rf-constellation", { t: 0, dt: 0, audio: 0, packets: [], rf: [{ ssid: "a", rssi: 0.5, channel: 6 }], talkers: [], headlines: [] }, state))
      .toEqual({ label: "RF", value: "1" });
    expect(vizHudMetric("talker-storm", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], headlines: [],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "particles", value: "2" });
    expect(vizHudMetric("kefrens-bars", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], headlines: [],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "talkers", value: "1" });
    expect(vizHudMetric("blob-mesh", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], headlines: [],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "blobs", value: "1" });
    expect(vizHudMetric("hn-rain", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [],
      headlines: [{ id: "hn:0", label: "HN", text: "Jemalloc" }],
    }, state)).toEqual({ label: "headlines", value: "1" });
    expect(vizHudMetric("hn-term", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [],
      headlines: [{ id: "hn:0", label: "HN", text: "Jemalloc", summary: "A new allocator." }],
    }, state)).toEqual({ label: "stories", value: "1" });
    expect(vizHudMetric("stereo-gram", {
      t: 0, dt: 0, audio: 0, packets: [], rf: [], headlines: [],
      talkers: [{ id: "10.0.0.1", rate: 80, role: "lan" }],
    }, state)).toEqual({ label: "talkers", value: "1" });
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
