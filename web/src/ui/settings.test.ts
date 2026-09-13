import { describe, expect, it } from "vitest";
import { compileMatcher } from "./settings";
import type { Device } from "../core/types";

const d = (over: Partial<Device> = {}): Device => ({
  ip: "192.168.86.4", mac: "", vendor: "Google", hostnames: ["Nest-Cam"], names: ["Nest-Cam"],
  sources: [], ports: [], ifaces: [], aliases: ["192.168.86.4"], first_seen: 0, last_seen: 0,
  bytes_in: 0, bytes_out: 0, packets: 0, role: "lan", online: true, ...over,
});

describe("compileMatcher", () => {
  it("matches CIDR, prefixes, names, and globs", () => {
    expect(compileMatcher("")(undefined, "1.1.1.1")).toBe(false);
    const cidr = compileMatcher("192.168.86.0/24");
    expect(cidr(undefined, "192.168.86.10")).toBe(true);
    expect(cidr(undefined, "10.0.0.1")).toBe(false);
    const prefix = compileMatcher("192.168.86.");
    expect(prefix(undefined, "192.168.86.10")).toBe(true);
    const name = compileMatcher("nest");
    expect(name(d(), "192.168.86.4")).toBe(true);
    expect(name(undefined, "other")).toBe(false);
    const glob = compileMatcher("Nest-*");
    expect(glob(d(), "192.168.86.4")).toBe(true);
    expect(compileMatcher("10.0.0.1")(undefined, "10.0.0.1")).toBe(true);
  });
});
