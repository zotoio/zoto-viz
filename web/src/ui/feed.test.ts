import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, FEED_SOURCES, feedViewShift, LiveFeed } from "./feed";
import type { NetScene } from "../graph/scene";
import type { Packet, TrafficMsg } from "../core/types";
import { mockPartial } from "../../test-support/mock-partial";

const feeds: LiveFeed[] = [];

function overlay(source: "traffic" | "transcript" | "both" = "traffic"): LiveFeed {
  const host = document.createElement("div");
  document.body.append(host);
  const feed = new LiveFeed(host, {
    pulseNow: { level: 0 },
    selectedIp: "",
    deviceOf: () => undefined,
    selectIp: () => {},
  } as unknown as NetScene);
  feeds.push(feed);
  feed.setConfig({ ...DEFAULT_FEED, on: true, source, layout: "ticker" });
  return feed;
}

afterEach(() => {
  for (const f of feeds) f.setConfig({ ...DEFAULT_FEED, on: false });
  feeds.length = 0;
  document.body.replaceChildren();
});

describe("feed defaults", () => {
  it("is on with shipped layouts and a traffic source that still carries live think", () => {
    expect(DEFAULT_FEED.on).toBe(true);
    expect(DEFAULT_FEED.source).toBe("traffic");
    expect(FEED_LAYOUTS.map((o) => o.value)).toEqual(["ticker", "bars", "both"]);
    expect(FEED_SCOPES.map((o) => o.value)).toContain("lan");
    expect(FEED_SOURCES.map((o) => o.value)).toEqual(["traffic", "transcript", "both"]);
    expect(FEED_SOURCES.find((o) => o.value === "traffic")?.hint).toMatch(/decoded packets/);
    expect(DEFAULT_FEED.textSize).toBe(12);
    expect(DEFAULT_FEED.density).toBe(36);
    expect(DEFAULT_FEED.includeSources).toBe(true);
  });
});

describe("feedViewShift", () => {
  it("shifts by half the overlay only when the view is tighter than 4× the feed", () => {
    expect(feedViewShift(0, "top", 800)).toBe(0);
    expect(feedViewShift(300, "top", 1199)).toBe(150);
    expect(feedViewShift(300, "left", 1199)).toBe(150);
    expect(feedViewShift(300, "right", 1199)).toBe(-150);
    expect(feedViewShift(300, "top", 1200)).toBe(0);
    expect(feedViewShift(300, "right", 2000)).toBe(0);
  });
});

describe("traffic overlay", () => {
  it("appends packets below earlier ones instead of replacing the visible list", () => {
    const feed = overlay("traffic");
    const t = 1_700_000_000;
    const pkt = (n: number, q: string): Packet =>
      [t + n, "out", "8.8.8.8", "dns", "udp/53", 80, "wlan0", q, "53", "192.168.86.4"];
    const ingest = (feed as unknown as { ingest(m: TrafficMsg): void }).ingest.bind(feed);
    ingest({
      ip: "@lan", peer: null, ts: t, packets: [pkt(1, "A one.example")],
      window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    });
    const first = [...feed.el.querySelectorAll(".row .tx")].map((el) => el.textContent);
    ingest({
      ip: "@lan", peer: null, ts: t + 2, packets: [pkt(2, "A two.example")],
      window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    });
    const texts = [...feed.el.querySelectorAll(".row .tx")].map((el) => el.textContent);
    expect(texts[0]).toContain("one.example");
    expect(texts.at(-1)).toContain("two.example");
    expect(texts).toHaveLength(first.length + 1);
  });

  it("applies --feed-size and clamps", () => {
    const feed = overlay("traffic");
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "traffic", layout: "ticker", textSize: 18 });
    expect(feed.el.style.getPropertyValue("--feed-size")).toBe("18px");
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "traffic", layout: "ticker", textSize: 99 });
    expect(feed.el.style.getPropertyValue("--feed-size")).toBe("20px");
  });

  it("queues traffic lines below the viewport until the ticker scrolls to them", () => {
    const feed = overlay("traffic");
    const ticker = feed.el.querySelector(".feed-ticker") as HTMLDivElement;
    Object.defineProperty(ticker, "clientHeight", { configurable: true, get: () => 80 });
    Object.defineProperty(ticker, "scrollHeight", { configurable: true, get: () => 400 });
    let top = 0;
    Object.defineProperty(ticker, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = Number(v); },
    });
    const t = 1_700_000_000;
    const pkt: Packet = [t, "out", "8.8.8.8", "dns", "udp/53", 80, "wlan0", "A www.example.com", "53", "192.168.86.4"];
    (feed as unknown as { ingest(m: TrafficMsg): void }).ingest({
      ip: "@lan", peer: null, ts: t, packets: [pkt],
      window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    });
    expect(top).toBe(0);
    feed.stepClock(0.016);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(400);
  });

  it("keeps following after a backlog queues below and a scroll event fires", () => {
    const feed = overlay("traffic");
    const ticker = feed.el.querySelector(".feed-ticker") as HTMLDivElement;
    Object.defineProperty(ticker, "clientHeight", { configurable: true, get: () => 80 });
    let height = 200;
    Object.defineProperty(ticker, "scrollHeight", { configurable: true, get: () => height });
    let top = 120;
    Object.defineProperty(ticker, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = Number(v); },
    });
    const t = 1_700_000_000;
    const pkt: Packet = [t, "out", "8.8.8.8", "dns", "udp/53", 80, "wlan0", "A www.example.com", "53", "192.168.86.4"];
    (feed as unknown as { ingest(m: TrafficMsg): void }).ingest({
      ip: "@lan", peer: null, ts: t, packets: [pkt],
      window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    });
    height = 600;
    ticker.dispatchEvent(new Event("scroll"));
    expect(top).toBe(120);
    feed.stepClock(0.5);
    expect(top).toBeGreaterThan(180);
    expect(top).toBeLessThan(320);
  });

  it("renders each source title as one line", () => {
    const feed = overlay("traffic");
    feed.setSourceHeadlines([
      { id: "hn:0", label: "HN", text: "A\nvery long NASA image of the day title" },
    ]);
    const tx = feed.el.querySelector(".row .tx") as HTMLSpanElement;
    expect(tx.textContent).toBe("A very long NASA image of the day title");
    expect(tx.textContent).not.toMatch(/\n/);
  });
});

/** feed.ts POLL_MS: one traffic poll per interval tick while the feed runs. */
const FEED_POLL_MS = 800;

describe("#198 the stored on drives the off class, the overlay and the feed loop", () => {
  function bareFeed(): LiveFeed {
    const host = document.createElement("div");
    document.body.append(host);
    const feed = new LiveFeed(host, mockPartial<NetScene>({
      pulseNow: mockPartial<NetScene["pulseNow"]>({ level: 0 }),
      selectedIp: "",
      deviceOf: () => undefined,
      selectIp: () => {},
    }));
    feeds.push(feed);
    return feed;
  }
  const polls = (): number => vi.mocked(fetch).mock.calls.length;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    vi.stubGlobal("fetch", vi.fn(async () => mockPartial<Response>({ ok: false })));
  });

  afterEach(() => {
    for (const f of feeds) f.setConfig({ on: false });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a partial config with no `on` is on: no off class, overlay shown, feed running", async () => {
    const feed = bareFeed();
    feed.setConfig({ layout: "bars", modulate: false });
    expect(feed.on).toBe(true);
    expect(feed.el.classList.contains("off")).toBe(false);
    expect(feed.el.hidden).toBe(!feed.on);
    expect(feed.el.querySelector<HTMLElement>(".feed-bars")!.hidden).toBe(false);
    const before = polls();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
    expect(polls() - before).toBe(3);
  });

  it("a partial config with on: false is off: off class, overlay hidden, feed stopped", async () => {
    const feed = bareFeed();
    feed.setConfig({ layout: "bars" });
    feed.setConfig({ layout: "bars", on: false });
    vi.mocked(fetch).mockClear();
    expect(feed.on).toBe(false);
    expect(feed.el.classList.contains("off")).toBe(true);
    expect(feed.el.hidden).toBe(!feed.on);
    expect(vi.getTimerCount()).toBe(0); // no poll interval and no rAF frame left pending
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 3);
    expect(polls()).toBe(0);
  });

  it("two partial configs then { on: true } leave exactly one feed loop (Pedant: N ticks, not 2N)", async () => {
    const feed = bareFeed();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    feed.setConfig({ layout: "bars", modulate: false });
    feed.setConfig({ layout: "bars", modulate: false });
    feed.setConfig({ on: true });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const n = 5;
    const before = polls();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * n);
    expect(polls() - before).toBe(n);
    expect(vi.getTimerCount()).toBe(2); // one poll interval + one pending rAF frame
  });
});
