import { describe, expect, it } from "vitest";
import type { Device, StateMsg } from "../../core/types";
import { capBluetoothDevices, defaultOpts, bluetooth } from "../../core/modes";
import { hostIdleTargetForMode, mergeHostIdleForViews, stateNeedsGolden } from "./golden-state";
import { goldenLanFixture } from "./golden-lan-state";

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
    const merged = mergeHostIdleForViews(emptyState(), [{
      slotId: "plugin:air-bt",
      idle: { fixture: "host" },
      target: hostIdleTargetForMode(bluetooth),
    }]).slotPaints.get("plugin:air-bt")!;
    const devices = capBluetoothDevices(merged.views?.bluetooth?.devices ?? [], defaultOpts(bluetooth));
    expect(devices.length).toBeGreaterThan(1);
    expect(devices.some((d) => d.hostnames.some((n) => /Hue/i.test(n)))).toBe(true);
    expect(merged.views?.bluetooth?.flows?.length).toBeGreaterThan(0);
  });

  it("keeps live REAL-PHONE when the LAN is quiet but bluetooth already has advertisers", () => {
    const live: StateMsg = {
      ...emptyState(),
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
    const { slotPaints, demoSlots } = mergeHostIdleForViews(live, [{
      slotId: "plugin:air-bt",
      idle: { fixture: "host" },
      target: hostIdleTargetForMode(bluetooth),
    }]);
    const merged = slotPaints.get("plugin:air-bt")!;
    expect(merged.views?.bluetooth?.devices?.[0]?.hostnames).toContain("REAL-PHONE");
    expect(demoSlots.size).toBe(0);
  });

  it("fills bluetooth demo on a busy LAN with no BT advertisers", () => {
    const busy = goldenLanFixture();
    delete busy.views?.bluetooth;
    const { slotPaints, demoSlots } = mergeHostIdleForViews(busy, [{
      slotId: "plugin:air-bt",
      idle: { fixture: "host" },
      target: hostIdleTargetForMode(bluetooth),
    }]);
    const merged = slotPaints.get("plugin:air-bt")!;
    expect(stateNeedsGolden(busy)).toBe(false);
    expect(merged.views?.bluetooth?.devices?.some((d) => /Hue/i.test(d.names.join(" ")))).toBe(true);
    expect(demoSlots.has("plugin:air-bt")).toBe(true);
  });
});
