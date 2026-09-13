import { describe, expect, it } from "vitest";
import { decodePacket, isNoise, kindFrom } from "./decode";
import type { Packet } from "../core/types";

const scene = { deviceOf: () => undefined } as never;
const pkt = (over: Partial<{ proto: string; tag: string; info: string; dir: "in" | "out"; ports: string; peer: string }>): Packet =>
  [0, over.dir ?? "out", over.peer ?? "1.1.1.1", over.proto ?? "DNS", over.tag ?? "udp/53", 64, "eth0", over.info ?? "A example.com", over.ports ?? "53", "192.168.86.10"];

describe("kindFrom", () => {
  it("classifies common protocols", () => {
    expect(kindFrom("DNS", "udp/53", "")).toEqual({ kind: "dns" });
    expect(kindFrom("MDNS", "udp/5353", "_http._tcp.local")).toEqual({ kind: "mdns" });
    expect(kindFrom("TLS", "tcp/443", "Client Hello")).toEqual({ kind: "tls" });
    expect(kindFrom("QUIC", "udp/443", "")).toEqual({ kind: "quic" });
    expect(kindFrom("HTTP", "tcp/80", "GET /")).toEqual({ kind: "http" });
    expect(kindFrom("DHCP", "udp/67", "")).toEqual({ kind: "dhcp" });
    expect(kindFrom("UDP", "udp/1900", "M-SEARCH")).toEqual({ kind: "ssdp" });
    expect(kindFrom("SSH", "tcp/22", "")).toEqual({ kind: "remote" });
    expect(kindFrom("RTSP", "tcp/554", "")).toEqual({ kind: "media" });
    expect(kindFrom("IEEE802.11", "wlan/beacon", "Beacon")).toEqual({ kind: "wifi" });
    expect(kindFrom("BTLE", "btle/adv", "")).toEqual({ kind: "bt" });
    expect(kindFrom("UDP", "udp/9", "")).toEqual({ kind: "other" });
  });
});

describe("isNoise", () => {
  it("drops ACKs and keepalives", () => {
    expect(isNoise("Application Data", "TLS")).toBe(true);
    expect(isNoise("[ACK]", "TCP")).toBe(true);
    expect(isNoise("[TCP Retransmission]", "TCP")).toBe(true);
    expect(isNoise("123 → 456 Len=12", "UDP")).toBe(true);
    expect(isNoise("A example.com", "DNS")).toBe(false);
  });
});

describe("decodePacket", () => {
  it("labels DNS, TLS, HTTP, Wi-Fi, and control packets", () => {
    expect(decodePacket(pkt({}), scene).kind).toBe("dns");
    expect(decodePacket(pkt({ proto: "DNS", info: "Standard query A example.com" }), scene).text).toMatch(/asks/);
    expect(decodePacket(pkt({ proto: "DNS", info: "Standard query response A example.com A 1.1.1.1" }), scene).text).toMatch(/example/);
    expect(decodePacket(pkt({ proto: "MDNS", tag: "udp/5353", info: "Standard query PTR _http._tcp.local" }), scene).kind).toBe("mdns");
    expect(decodePacket(pkt({ proto: "TLS", tag: "tcp/443", info: "SNI=api.example.com" }), scene).text).toMatch(/TLS/);
    expect(decodePacket(pkt({ proto: "TLS", tag: "tcp/443", info: "Client Hello", dir: "in" }), scene).text).toMatch(/hello/i);
    expect(decodePacket(pkt({ proto: "HTTP", tag: "tcp/80", info: "GET /index.html" }), scene).text).toMatch(/GET/);
    expect(decodePacket(pkt({ proto: "HTTP", tag: "tcp/80", info: "HTTP/1.1 404 Not Found" }), scene).text).toMatch(/404/);
    expect(decodePacket(pkt({ proto: "DHCP", tag: "udp/67", info: "DHCP Discover hostname nest" }), scene).text).toMatch(/DHCP/);
    expect(decodePacket(pkt({ proto: "SSDP", tag: "udp/1900", info: "M-SEARCH * HTTP/1.1" }), scene).text).toMatch(/SSDP/);
    expect(decodePacket(pkt({ proto: "TCP", tag: "tcp/22", info: "[SYN] Seq=0" }), scene).text).toMatch(/connect/);
    expect(decodePacket(pkt({ proto: "TCP", tag: "tcp/22", info: "[FIN, ACK]" }), scene).text).toMatch(/close/);
    expect(decodePacket(pkt({ proto: "TCP", tag: "tcp/22", info: "[RST]" }), scene).text).toMatch(/reset/);
    expect(decodePacket(pkt({ proto: "QUIC", tag: "udp/443", info: "Initial" }), scene).text).toMatch(/QUIC/);
    expect(decodePacket(pkt({ proto: "ICMP", tag: "icmp", info: "Echo request" }), scene).text).toMatch(/ping/);
    expect(decodePacket(pkt({ proto: "IEEE802.11", tag: "wlan/beacon", info: "Beacon SSID=home" }), scene).kind).toBe("wifi");
    expect(decodePacket(pkt({ proto: "BTLE", tag: "btle/adv", info: "" }), scene).text).toMatch(/advert/);
    expect(decodePacket(pkt({ proto: "UDP", tag: "udp/9", info: "" }), scene).text).toMatch(/udp\/9|UDP|packet/i);
  });
});
