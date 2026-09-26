import { describe, expect, it } from "vitest";
import { bluetooth, type ViewMode } from "../core/modes";
import type { Device, StateMsg } from "../core/types";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { paintFeedState } from "./feed-paint";
import type { PluginView } from "../plugins/plugin";

const airBtSpec = {
  id: "plugin:air-bt",
  name: "Air Bluetooth",
  version: 1,
  engine: "graph",
  base: "bluetooth",
  idle: { fixture: "host" },
} as PluginView;

const airSsidSpec = {
  id: "plugin:air-ssid",
  name: "Air Wi-Fi",
  version: 1,
  engine: "graph",
  base: "wifi",
  idle: { fixture: "host" },
} as PluginView;

const airBtMode: ViewMode = {
  id: "plugin:air-bt",
  label: "BT",
  pluginId: "air-bt",
  graphBase: "bluetooth",
} as ViewMode;

const airSsidMode: ViewMode = {
  id: "plugin:air-ssid",
  label: "Wi-Fi",
  pluginId: "air-ssid",
  graphBase: "wifi",
} as ViewMode;

const topologyMode: ViewMode = { id: "topology", label: "Topology" } as ViewMode;

function modeFor(id: string): ViewMode {
  if (id === "plugin:air-bt") return airBtMode;
  if (id === "plugin:air-ssid") return airSsidMode;
  return topologyMode;
}

function specFor(modeId: string): PluginView | null {
  if (modeId === "plugin:air-bt") return airBtSpec;
  if (modeId === "plugin:air-ssid") return airSsidSpec;
  return null;
}

const quietLan = (): StateMsg => ({
  type: "state",
  ts: 1,
  iface: "eth0",
  interfaces: ["eth0"],
  network: "10.0.0.0/24",
  local_ip: "10.0.0.2",
  gateway: "10.0.0.1",
  uptime: 10,
  stats: { pps: 0, bps: 0, devices: 1, online: 1, flows: 0, active_flows: 0, packets: 0, bytes: 0 },
  devices: [{
    ip: "10.0.0.2",
    mac: "aa:bb:cc:dd:ee:01",
    vendor: "",
    hostnames: ["host"],
    names: ["host"],
    sources: ["lan"],
    ports: [],
    ifaces: ["eth0"],
    aliases: [],
    first_seen: 0,
    last_seen: 1,
    bytes_in: 0,
    bytes_out: 0,
    packets: 0,
    role: "self",
    online: true,
  } satisfies Device],
  flows: [],
});

describe("paintFeedState (main.ts wiring)", () => {
  it("keeps REAL-PHONE on a quiet LAN when bluetooth already has live advertisers", () => {
    const raw: StateMsg = {
      ...quietLan(),
      views: {
        bluetooth: {
          devices: [{
            ip: "bt:real",
            mac: "aa:bb:cc:dd:ee:ff",
            vendor: "",
            hostnames: ["REAL-PHONE"],
            names: ["REAL-PHONE"],
            sources: ["bt"],
            ports: ["BTLE"],
            ifaces: [],
            aliases: [],
            first_seen: 0,
            last_seen: 1,
            bytes_in: 1,
            bytes_out: 1,
            packets: 1,
            role: "lan",
            online: true,
          } satisfies Device],
          flows: [],
          hub: "bt:real",
          self: "bt:real",
        },
      },
    };
    const { state, demoSlots } = paintFeedState({
      raw,
      heroModeId: "plugin:air-bt",
      mosaicOn: false,
      mosaicTileIds: [],
      modeById: modeFor,
      pluginSpecForMode: specFor,
    });
    expect(state.views?.bluetooth?.devices?.[0]?.hostnames).toContain("REAL-PHONE");
    expect(demoSlots.size).toBe(0);
  });

  it("seeds bluetooth demo on a busy LAN with no advertisers", () => {
    const raw = goldenLanFixture();
    delete raw.views?.bluetooth;
    const { state, demoSlots } = paintFeedState({
      raw,
      heroModeId: "plugin:air-bt",
      mosaicOn: false,
      mosaicTileIds: [],
      modeById: modeFor,
      pluginSpecForMode: specFor,
    });
    expect(state.views?.bluetooth?.devices?.length).toBeGreaterThan(1);
    expect(demoSlots.has("hero")).toBe(true);
  });

  it("on a wall with air-bt and air-ssid only fills the empty bluetooth slice", () => {
    const raw = goldenLanFixture();
    delete raw.views?.bluetooth;
    const { state, demoSlots } = paintFeedState({
      raw,
      heroModeId: "topology",
      mosaicOn: true,
      mosaicTileIds: ["plugin:air-bt", "plugin:air-ssid"],
      modeById: modeFor,
      pluginSpecForMode: specFor,
    });
    expect(state.views?.bluetooth?.devices?.length).toBeGreaterThan(1);
    expect(state.views?.wifi?.devices?.length).toBeGreaterThan(0);
    expect(demoSlots.has("plugin:air-bt")).toBe(true);
    expect(demoSlots.has("plugin:air-ssid")).toBe(false);
  });
});
