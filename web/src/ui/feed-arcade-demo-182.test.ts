/** @vitest-environment happy-dom */
/**
 * #182: the feed panel's status line while an arcade idle feed shows demo rows (LiveFeed.setArcadeDemo).
 * Unit rows on the real LiveFeed: what the status line reads after each step. Counts and text only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FEED, FEED_WAITING_TEXT, LiveFeed } from "./feed";
import type { NetScene } from "../graph/scene";
import type { Packet, TrafficMsg } from "../core/types";

const DEMO_TEXT = "Demo data";
const NOTICE = "Pack install blocked: reload to retry";
const feeds: LiveFeed[] = [];

function mountFeed(): { feed: LiveFeed; status: () => string; ingest: (packets: Packet[]) => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const feed = new LiveFeed(host, {
    pulseNow: { level: 0 },
    selectedIp: "",
    deviceOf: () => undefined,
    selectIp: () => {},
  } as unknown as NetScene);
  feeds.push(feed);
  feed.setConfig({ ...DEFAULT_FEED, on: true, source: "traffic", layout: "ticker" });
  const run = (feed as unknown as { ingest(m: TrafficMsg): void }).ingest.bind(feed);
  const ingest = (packets: Packet[]) => run({
    ip: "@lan", peer: null, ts: 0, packets, window: null,
    summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
  });
  const status = () => host.querySelector<HTMLElement>(".feed-hint")?.textContent ?? "";
  return { feed, status, ingest };
}

const T0 = 1_700_000_000;
const livePacket = (n: number): Packet => [T0 + n, "out", "93.184.216.34", "TCP", "tcp/443", 74, "eth0", "[SYN] Seq=0", `${50000 + n}→443`, "192.168.1.50"];

describe("#182 feed panel status line and the arcade demo badge", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    for (const f of feeds) f.setConfig({ ...DEFAULT_FEED, on: false });
    feeds.length = 0;
    document.body.replaceChildren();
  });

  it("an empty poll while the demo badge shows keeps the demo text (no stale \"waiting for packets…\")", () => {
    const { feed, status, ingest } = mountFeed();
    ingest([]);
    expect(status(), "a fresh feed's empty poll").toBe(FEED_WAITING_TEXT);
    feed.setArcadeDemo(true, DEMO_TEXT);
    expect(status()).toBe(DEMO_TEXT);
    ingest([]);
    expect(status(), "after an empty poll").toBe(DEMO_TEXT);
    ingest([]);
    expect(status(), "after a second empty poll").toBe(DEMO_TEXT);
  });

  it("live takeover clears the demo status for good: the badge's later hide does not wipe an operator notice set after it", () => {
    const { feed, status, ingest } = mountFeed();
    feed.setArcadeDemo(true, DEMO_TEXT);
    expect(status()).toBe(DEMO_TEXT);
    ingest([livePacket(1)]);
    expect(status(), "live rows took over").toBe("");
    feed.showOperatorNotice(NOTICE);
    expect(status()).toBe(NOTICE);
    // the arcade view's badge goes after the feed saw live rows (event order: feed first, badge next)
    feed.setArcadeDemo(false, "");
    expect(status(), "operator notice after the badge hid").toBe(NOTICE);
  });

  it("an operator notice is never overwritten by the demo badge text, and survives the badge going", () => {
    const { feed, status } = mountFeed();
    feed.showOperatorNotice(NOTICE);
    feed.setArcadeDemo(true, DEMO_TEXT);
    expect(status(), "notice while the demo shows").toBe(NOTICE);
    feed.setArcadeDemo(true, "Demo traffic around box");
    expect(status(), "notice after the badge text changed").toBe(NOTICE);
    feed.setArcadeDemo(false, "");
    expect(status(), "notice after the badge went").toBe(NOTICE);
  });

  it("positive: with no notice the demo text replaces the stale waiting line and goes with the badge", () => {
    const { feed, status, ingest } = mountFeed();
    ingest([]);
    expect(status()).toBe(FEED_WAITING_TEXT);
    feed.setArcadeDemo(true, DEMO_TEXT);
    expect(status()).toBe(DEMO_TEXT);
    feed.setArcadeDemo(false, "");
    expect(status()).toBe("");
  });
});
