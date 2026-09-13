import { describe, expect, it } from "vitest";
import { collapseByName } from "./collapse";
import type { Device, Flow, StateMsg } from "./types";

function device(ip: string, role: Device["role"], name: string, extra: Partial<Device> = {}): Device {
  return {
    ip, mac: "", vendor: "", hostnames: [name], names: [name], sources: [], ports: ["tcp/443"], ifaces: [],
    aliases: [], first_seen: 1, last_seen: 10, bytes_in: 10, bytes_out: 10, packets: 1, role, online: true, ...extra,
  };
}

function flow(a: string, b: string, extra: Partial<Flow> = {}): Flow {
  return {
    a, b, bytes: 10, packets: 1, ports: ["tcp/443"], protos: ["TLS"], ifaces: ["eth0"],
    first_seen: 1, last_seen: 2, rate: 1, ...extra,
  };
}

describe("collapseByName", () => {
  it("merges internet hosts that share a name and folds flows", () => {
    const msg = {
      devices: [
        device("1.1.1.1", "internet", "cdn.example"),
        device("1.1.1.2", "internet", "cdn.example", { bytes_in: 50, online: false }),
      ],
      flows: [
        flow("1.1.1.1", "192.168.1.2"),
        flow("1.1.1.2", "192.168.1.2", { ports: ["tcp/80"], protos: ["HTTP"], ifaces: ["wlan0"] }),
        flow("1.1.1.1", "1.1.1.2"),
      ],
    } as unknown as StateMsg;
    const { msg: out, map } = collapseByName(msg);
    expect(out.devices).toHaveLength(1);
    expect(out.devices[0]!.members?.length).toBeGreaterThan(1);
    expect(map.get("1.1.1.2") ?? out.devices[0]!.ip).toBeTruthy();
    expect(out.flows.some((f) => f.a === f.b)).toBe(false);
    expect(out.flows[0]!.ports.length).toBeGreaterThanOrEqual(1);
  });

  it("does not merge LAN devices", () => {
    const msg = {
      devices: [
        device("192.168.1.2", "lan", "Android.local"),
        device("192.168.1.3", "lan", "Android.local"),
      ],
      flows: [],
    } as unknown as StateMsg;
    const { msg: out } = collapseByName(msg);
    expect(out.devices).toHaveLength(2);
  });
});
