import { describe, expect, it } from "vitest";
import { decodePayload, hexDump, hexToBytes } from "./payload";

const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

const msg = (over: Partial<Parameters<typeof decodePayload>[0]>) => decodePayload({
  t: 0, src: "", proto: "TCP", size: 0, ports: "1→80", info: "", payload: "", captured: 0, total: 0, ...over,
});

describe("hex", () => {
  it("round-trips and dumps", () => {
    expect(Array.from(hexToBytes("414200"))).toEqual([0x41, 0x42, 0x00]);
    const out = hexDump(new Uint8Array([0x41, 0x42, 0x00]));
    expect(out).toMatch(/41 42/);
    expect(out).toMatch(/AB/);
  });
});

describe("decodePayload", () => {
  it("handles empty, HTTP, TLS, NTP, and text", () => {
    expect(msg({ proto: "TCP" }).title).toMatch(/no payload/);
    const http = msg({
      proto: "HTTP", size: 40, ports: "1234→80",
      payload: hex("GET / HTTP/1.1\r\nHost: a\r\n\r\nbody"), captured: 40, total: 40,
    });
    expect(http.title).toMatch(/HTTP|GET/);
    const tls = msg({
      proto: "TLS", ports: "1→443", info: "Application Data", payload: "1703030001aa", captured: 6, total: 6,
    });
    expect(tls.title.length).toBeGreaterThan(0);
    const ntp = msg({ proto: "NTP", ports: "123→123", payload: "1b000000" + "00".repeat(44), captured: 48, total: 48 });
    expect(ntp.title.length).toBeGreaterThan(0);
    const text = msg({ proto: "TCP", ports: "1→9", payload: hex('{"ok":true}\n'), captured: 12, total: 12 });
    expect(text.title).toMatch(/text|JSON|HTTP/);
    const trunc = msg({ proto: "TCP", payload: "", captured: 0, total: 512 });
    expect(trunc.note || trunc.title).toBeTruthy();
  });
});
