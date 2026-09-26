import { describe, expect, it } from "vitest";
import type { StateMsg } from "../../core/types";
import { capBluetoothDevices, defaultOpts, bluetooth } from "../../core/modes";
import { mergeHostIdleForViews } from "./golden-state";

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

describe("air-bt idle on an empty board", () => {
  it("paints demo bluetooth advertisers instead of a flat empty graph", () => {
    const merged = mergeHostIdleForViews(emptyState(), [{ fixture: "host" }]);
    const devices = capBluetoothDevices(merged.views?.bluetooth?.devices ?? [], defaultOpts(bluetooth));
    expect(devices.length).toBeGreaterThan(1);
    expect(devices.some((d) => d.hostnames.some((n) => /Hue/i.test(n)))).toBe(true);
    expect(merged.views?.bluetooth?.flows?.length).toBeGreaterThan(0);
  });
});
