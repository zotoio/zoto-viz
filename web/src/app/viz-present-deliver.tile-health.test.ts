import { describe, expect, it, vi } from "vitest";
import type { StateMsg } from "../core/types";
import { tickVizPresentDeliver, type VizPresentDeliverHost } from "./viz-present-deliver";
import { NetScene } from "../graph/scene";
import { RenderHost } from "../graph/render-host";
import { VizFrameBudget } from "../plugins/viz-host";
import { VizHud } from "../ui/viz-hud";

function minimalState(): StateMsg {
  return {
    ts: 1,
    stats: { active_flows: 0, devices: 0, packets: 0 },
    devices: [],
    flows: [],
    sources: [],
    plugin_state: {},
  };
}

describe("viz present deliver tile-health hooks", () => {
  it("production path calls onVizFrameDelivered when a viz frame is delivered", () => {
    const wall = document.createElement("div");
    document.body.append(wall);
    const renderHost = new RenderHost(wall);
    const scene = new NetScene(document.createElement("div"), { host: renderHost });
    const vizHud = new VizHud(document.createElement("div"), () => {});
    const delivered = vi.fn();
    const host: VizPresentDeliverHost = {
      modeById: () => ({
        id: "plugin:packet-tunnel",
        label: "tunnel",
        pluginId: "packet-tunnel",
        kind: "plugin",
        graphBase: "topology",
        options: [],
        config: {},
      }),
      modeSelValue: () => "plugin:packet-tunnel",
      pluginSpecs: [{
        id: "packet-tunnel",
        name: "tunnel",
        version: 1,
        engine: "graph",
        base: "topology",
        capabilities: ["viz.read"],
        has_frontend: false,
        has_sky: false,
        has_sky_shader: false,
        has_backend: false,
        has_datasource: false,
      }],
      tsWatchId: () => "",
      mosaic: null,
      scene,
      renderHost,
      sandbox: { handlers: {}, frame: vi.fn(), tick: vi.fn() },
      vizBudget: new VizFrameBudget(),
      getVizWriter: () => null,
      bindVizWriter: () => {},
      vizHud,
      optsFor: () => ({}),
      mosaicTileViewId: (id) => id,
      pluginSpecForMode: () => null,
      syncPanelPackSub: () => {},
      feedTitleCube: { setActive: () => {}, sync: () => {} },
      getVizFrameClockMs: () => 0 as import("../core/viz-time").MonoMs,
      setVizFrameClockMs: () => {},
      syncVizBudgetTileScope: () => {},
      onVizFrameDelivered: delivered,
    };
    tickVizPresentDeliver(minimalState(), host);
    expect(delivered).toHaveBeenCalledTimes(1);
  });
});
