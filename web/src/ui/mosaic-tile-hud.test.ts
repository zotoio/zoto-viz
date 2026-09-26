import { describe, expect, it } from "vitest";
import { MosaicTileHudLayer } from "./mosaic-tile-hud";

describe("MosaicTileHudLayer", () => {
  it("shows the same skip count on every tile of a duplicated pack", () => {
    const layer = new MosaicTileHudLayer();
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    paneA.className = "mosaic-pane";
    paneB.className = "mosaic-pane";
    layer.sync(["a", "b"], (slot) => (slot === "a" ? paneA : paneB));
    const stats = { lastMs: 2, overBudget: 0, skipped: 5, total: 10 };
    layer.tickForPack("star-sines", "Sines", ["a", "b"], {
      stats,
      frame: { t: 1, audio: 0, packets: [], talkers: [], rf: [], headlines: [] },
      state: {
        type: "state", ts: 1, iface: "", interfaces: [], network: "", local_ip: "", gateway: "",
        uptime: 0,
        stats: { pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0 },
        devices: [], flows: [],
      },
      now: 1000,
    });
    const skipA = paneA.querySelector(".viz-hud-skip")?.textContent ?? "";
    const skipB = paneB.querySelector(".viz-hud-skip")?.textContent ?? "";
    expect(skipA).toBe(skipB);
    expect(skipA.length).toBeGreaterThan(0);
    layer.clear();
  });
});
