import { describe, expect, it } from "vitest";
import {
  clamp, css, fade, FadeLog, hms, isExchangeStart, isKnown, noReplyExpected, portRole, portSuffix, sizeOf,
} from "./arcade";
import { DEFAULT_THEME } from "../core/themes";
import type { Device } from "../core/types";

describe("arcade helpers", () => {
  it("bounds, sizes, and classifies packets", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(css(0xff00aa)).toBe("#ff00aa");
    expect(sizeOf(64)).toBeGreaterThan(2);
    expect(fade(10, 10)).toBeGreaterThan(0);
    expect(isKnown({ role: "lan" } as Device)).toBe(true);
    expect(isKnown({ role: "internet" } as Device)).toBe(false);
    expect(noReplyExpected("255.255.255.255")).toBe(true);
    expect(noReplyExpected("224.0.0.251")).toBe(true);
    expect(noReplyExpected("192.168.1.10")).toBe(false);
    expect(portRole("TCP", "tcp/443", "51234→443")).toBe("request");
    expect(portRole("TCP", "tcp/443", "443→51234")).toBe("answer");
    expect(portRole("ICMP", "icmp", "1→1")).toBe("ambiguous");
    expect(isExchangeStart("TLS", "Application Data")).toBe(false);
    expect(isExchangeStart("TCP", "[SYN]")).toBe(true);
    expect(portSuffix("tcp/443", "TLS")).toMatch(/443|tls/i);
    expect(hms(0)).toMatch(/:/);
  });
});

describe("FadeLog", () => {
  it("folds repeats and draws", () => {
    const log = new FadeLog(3, "events", "quiet");
    expect(log.height).toBeGreaterThan(20);
    log.push({ key: "a", t: 1, wall: 1, mark: "x", markColor: "#f00", color: "#0f0", head: "nest", tail: "miss" });
    log.push({ key: "a", t: 2, wall: 2, mark: "x", markColor: "#f00", color: "#0f0", head: "nest", tail: "miss" });
    expect(log.lines[0]!.count).toBe(2);
    log.expire(20);
    expect(log.lines.length).toBe(0);
    log.push({ key: "b", t: 1, wall: 1, mark: "x", markColor: "#f00", color: "#0f0", head: "x", tail: "y" });
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d");
    if (g) log.draw(g, DEFAULT_THEME.ui, "sans-serif", 0, 0, 400, 1);
    log.clear();
    expect(log.lines).toHaveLength(0);
  });
});
