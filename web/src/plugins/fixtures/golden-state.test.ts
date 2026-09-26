import { describe, expect, it } from "vitest";
import { bluetooth } from "../../core/modes";
import { goldenLanFixture } from "./golden-lan-state";
import {
  hostIdleTargetForMode,
  mergeHostIdleForViews,
  parsePluginIdle,
  pluginIdleOf,
  stateNeedsGolden,
  withGoldenIfIdle,
} from "./golden-state";
import type { StateMsg } from "../../core/types";

const emptyState = (): StateMsg => ({
  type: "state",
  ts: 1,
  iface: "",
  interfaces: [],
  network: "",
  local_ip: "",
  gateway: "",
  uptime: 0,
  stats: {
    pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
  },
  devices: [],
  flows: [],
});

describe("goldenLanFixture", () => {
  it("ships modest LAN, CPU, Bluetooth, and source slices", () => {
    const golden = goldenLanFixture();
    expect(golden.devices.length).toBeGreaterThanOrEqual(8);
    expect(golden.flows.length).toBeGreaterThanOrEqual(5);
    expect(golden.views?.cpu?.devices.length).toBeGreaterThanOrEqual(4);
    expect(golden.views?.bluetooth?.devices.length).toBeGreaterThanOrEqual(3);
    expect(golden.sources?.nasa?.items?.length).toBeGreaterThan(0);
  });
});

describe("withGoldenIfIdle", () => {
  const idle = { fixture: "host" as const };

  it("fills an empty monitor snapshot from the golden host fixture", () => {
    const merged = withGoldenIfIdle(emptyState(), idle);
    expect(merged.devices.length).toBeGreaterThanOrEqual(8);
    expect(merged.flows.length).toBeGreaterThanOrEqual(5);
  });

  it("merges only the bluetooth slice when that view declares host idle", () => {
    const busy = goldenLanFixture();
    delete busy.views?.bluetooth;
    const { slotPaints } = mergeHostIdleForViews(busy, [{
      slotId: "tile-bt",
      idle,
      target: hostIdleTargetForMode(bluetooth),
    }]);
    const merged = slotPaints.get("tile-bt")!;
    expect(merged.devices[0]!.packets).toBe(busy.devices[0]!.packets);
    expect(merged.views?.bluetooth?.devices?.some((d) => d.names.includes("Hue bulb"))).toBe(true);
  });

  it("keeps live traffic when the graph already has data", () => {
    const live = goldenLanFixture();
    live.devices[0]!.packets = 999;
    const merged = withGoldenIfIdle(live, idle);
    expect(merged.devices[0]!.packets).toBe(999);
  });

  it("parses plugin idle refs from viz or visualisation blocks", () => {
    expect(parsePluginIdle({ fixture: "host" })).toEqual({ fixture: "host" });
    expect(pluginIdleOf({ viz: { idle: { fixture: "host" }, graphWalk: false, maxBuffers: 1, maxBufferFloats: 8, maxParticles: 0, uniforms: [], ubo: {} as never } })).toEqual({ fixture: "host" });
    expect(pluginIdleOf({ idle: { fixture: "host" } })).toEqual({ fixture: "host" });
    expect(stateNeedsGolden(emptyState())).toBe(true);
    expect(stateNeedsGolden(goldenLanFixture())).toBe(false);
  });
});
