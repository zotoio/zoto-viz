import { describe, expect, it } from "vitest";
import {
  ago, deviceKind, displayName, fmtBytes, idsOf, isWeakHostName, unescapeDns, usefulAlias, usefulName,
  type Device,
} from "./types";

const d = (over: Partial<Device>): Device => ({
  ip: "192.168.86.10", mac: "", vendor: "", hostnames: [], names: [], sources: [], ports: [], ifaces: [],
  aliases: ["10.0.0.2"], first_seen: 0, last_seen: 0, bytes_in: 0, bytes_out: 0, packets: 0, role: "lan", online: true,
  ...over,
});

describe("fmtBytes", () => {
  it("formats bytes and rates", () => {
    expect(fmtBytes(0)).toMatch(/0 B/);
    expect(fmtBytes(2048)).toMatch(/2/);
    expect(fmtBytes(1_500_000, true)).toMatch(/s/);
  });
});

describe("deviceKind", () => {
  it("classifies roles and names", () => {
    expect(deviceKind(d({ ip: "ap:aa", role: "lan" }))).toBe("wifi");
    expect(deviceKind(d({ ip: "bt:aa", names: ["Hue bulb"] }))).toBe("light");
    expect(deviceKind(d({ ip: "bt:aa", names: ["Pixel 8"] }))).toBe("phone");
    expect(deviceKind(d({ ip: "bt:aa", names: ["TV"] }))).toBe("tv");
    expect(deviceKind(d({ ip: "bt:aa", names: ["buds"] }))).toBe("speaker");
    expect(deviceKind(d({ ip: "bt:aa", names: ["mouse"] }))).toBe("iot");
    expect(deviceKind(d({ role: "self" }))).toBe("self");
    expect(deviceKind(d({ role: "gateway" }))).toBe("gateway");
    expect(deviceKind(d({ role: "local" }))).toBe("local");
    expect(deviceKind(d({ role: "multicast" }))).toBe("multicast");
    expect(deviceKind(d({ role: "internet" }))).toBe("internet");
    expect(deviceKind(d({ names: ["Chromecast"] }))).toBe("tv");
    expect(deviceKind(d({ names: ["Sonos"] }))).toBe("speaker");
    expect(deviceKind(d({ names: ["Philips Hue"] }))).toBe("light");
    expect(deviceKind(d({ names: ["HP LaserJet"], ports: ["tcp/9100"] }))).toBe("printer");
    expect(deviceKind(d({ names: ["UniFi AP"] }))).toBe("wifi");
    expect(deviceKind(d({ names: ["iPad"] }))).toBe("tablet");
    expect(deviceKind(d({ names: ["iPhone"] }))).toBe("phone");
    expect(deviceKind(d({ names: ["MacBook Pro"] }))).toBe("computer");
    expect(deviceKind(d({ names: ["Ring doorbell"] }))).toBe("camera");
    expect(deviceKind(d({ names: ["Shelly"] }))).toBe("iot");
    expect(deviceKind(d({ names: ["fridge"] }))).toBe("lan");
  });
});

describe("names", () => {
  it("unescapes DNS and ranks display names", () => {
    expect(unescapeDns("Foo\\032Bar")).toBe("Foo Bar");
    expect(usefulName("nest-cam.local")).toBe(true);
    expect(usefulName("1.2.3.4.in-addr.arpa")).toBe(false);
    expect(usefulName("_http._tcp.local")).toBe(false);
    expect(usefulName("")).toBe(false);
    expect(isWeakHostName("Android.local")).toBe(true);
    expect(isWeakHostName("api.cursor.sh")).toBe(false);
    expect(usefulAlias("192.168.1.1")).toBe(true);
    expect(usefulAlias("127.0.0.1")).toBe(false);
    expect(displayName(d({ names: ["api.example"], hostnames: ["1.2.3.4.in-addr.arpa"] }))).toBe("api.example");
    expect(displayName(d({ names: [], hostnames: [] }))).toBe("192.168.86.10");
    expect(idsOf(d({ members: ["a", "b"] }), "fallback")).toBe("a,b");
    expect(idsOf(undefined, "1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("ago", () => {
  it("formats relative time", () => {
    expect(ago(0, 100)).toBe("never");
    expect(ago(100, 101)).toBe("now");
    expect(ago(100, 140)).toMatch(/s ago/);
    expect(ago(100, 400)).toMatch(/m ago/);
    expect(ago(100, 4000)).toMatch(/h ago/);
    expect(ago(100, 200000)).toMatch(/d ago/);
  });
});
