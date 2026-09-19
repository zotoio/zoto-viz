import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, FEED_SOURCES, feedViewShift, LiveFeed } from "./feed";
import type { NetScene } from "../graph/scene";
import type { Packet, TrafficMsg } from "../core/types";

const feeds: LiveFeed[] = [];

function overlay(source: "traffic" | "transcript" | "both" = "transcript"): LiveFeed {
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
    expect(FEED_SOURCES.find((o) => o.value === "traffic")?.hint).toMatch(/thinking/);
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

describe("transcript overlay", () => {
  it("keeps a turn's thinking in one row so paragraphs do not pile up", () => {
    const feed = overlay();
    expect(feed.el.classList.contains("transcript")).toBe(true);
    expect(feed.el.classList.contains("chat-log")).toBe(true);
    feed.seedTranscript([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        thinking: "1. greet\n\n2. wait for a task",
        content: "hello — say what you want on the LAN",
      },
    ]);
    const rows = [...feed.el.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".k")?.textContent)).toEqual(["you", "think", "agent"]);
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("greet");
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("wait for a task");
  });

  it("renders agent markdown as html", () => {
    const feed = overlay();
    feed.seedTranscript([{ role: "assistant", content: "**nest** is loud" }]);
    expect(feed.el.querySelector(".row.agent .tx strong")?.textContent).toBe("nest");
    feed.pushChat("agent", "use `tcp/443`", true);
    feed.flushReveal();
    expect(feed.el.querySelector(".row.agent .tx code")?.textContent).toBe("tcp/443");
  });

  it("streams newlines into the same think line", () => {
    const feed = overlay();
    feed.pushChat("think", "Analyze the user input:\n", true);
    feed.pushChat("think", "they said hi\nGoal: reply", true);
    feed.flushReveal();
    const think = [...feed.el.querySelectorAll(".row.think")];
    expect(think).toHaveLength(1);
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Analyze the user input:");
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Goal: reply");
  });

  it("renders thought markdown as html", () => {
    const feed = overlay();
    feed.pushChat("think", "1. **greet**\n2. wait", false);
    expect(feed.el.querySelector(".row.think .tx strong")?.textContent).toBe("greet");
    expect(feed.el.querySelector(".row.think .tx ol, .row.think .tx ul")).toBeTruthy();
  });

  it("appends later turns below earlier ones and drops the oldest from the top", () => {
    const feed = overlay();
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "transcript", layout: "ticker", density: 12 });
    feed.pushChat("you", "first");
    feed.pushChat("agent", "ok");
    for (let i = 0; i < 12; i++) feed.pushChat("you", `m${i}`);
    const texts = [...feed.el.querySelectorAll(".row .tx")].map((el) => el.textContent);
    expect(texts[0]).not.toBe("first");
    expect(texts[0]).not.toBe("ok");
    expect(texts.at(-1)).toBe("m11");
    expect(feed.snapshot(1)[0]).toContain("m11");
  });

  it("shows a composer on the transcript overlay and submits it", () => {
    const feed = overlay();
    const composer = feed.el.querySelector(".feed-composer") as HTMLDivElement;
    expect(composer.hidden).toBe(false);
    const sent: string[] = [];
    feed.onSend = (t) => { sent.push(t); };
    feed.ask.value = "who is loud";
    feed.el.querySelector<HTMLButtonElement>(".feed-send")!.click();
    expect(sent).toEqual(["who is loud"]);
    expect(feed.ask.value).toBe("");
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "traffic", layout: "ticker" });
    expect(composer.hidden).toBe(true);
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "both", layout: "ticker" });
    expect(composer.hidden).toBe(false);
    feed.ask.value = "queued";
    feed.onSend = () => false;
    feed.el.querySelector<HTMLButtonElement>(".feed-send")!.click();
    expect(feed.ask.value).toBe("queued");
  });

  it("shows a thinking row until the first token, then drops it if the model never thinks", () => {
    const feed = overlay();
    feed.setThinking(true);
    expect(feed.el.classList.contains("thinking")).toBe(true);
    expect(feed.el.getAttribute("aria-busy")).toBe("true");
    expect(feed.el.querySelector(".feed-hint")?.textContent).toBe("thinking…");
    const pending = feed.el.querySelector(".row.think.pending .tx");
    expect(pending?.textContent?.trim()).toBe("thinking…");
    feed.pushChat("think", "checking talkers\n", true);
    feed.flushReveal();
    expect(feed.el.querySelector(".row.think.pending")).toBeNull();
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("checking talkers");
    feed.setThinking(false);
    expect(feed.el.classList.contains("thinking")).toBe(false);
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("checking talkers");

    const quiet = overlay();
    quiet.setThinking(true);
    quiet.pushChat("agent", "hi", true);
    quiet.flushReveal();
    expect(quiet.el.querySelector(".row.think")).toBeNull();
    expect(quiet.el.querySelector(".row.agent .tx")?.textContent?.trim()).toBe("hi");
    quiet.setThinking(false);
    expect(quiet.el.getAttribute("aria-busy")).toBe("false");
  });
});

describe("live agent trace", () => {
  it("streams thinking onto the traffic overlay", () => {
    const feed = overlay("traffic");
    expect(feed.el.classList.contains("transcript")).toBe(false);
    feed.setThinking(true);
    expect(feed.el.querySelector(".feed-hint")?.textContent).toBe("thinking…");
    expect(feed.el.querySelector(".row.think.pending .tx")?.textContent?.trim()).toBe("thinking…");
    feed.pushChat("think", "the nest cam is loud\n", true);
    feed.flushReveal();
    expect(feed.el.classList.contains("trace")).toBe(true);
    expect(feed.el.querySelector(".row.think.pending")).toBeNull();
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("the nest cam is loud");
    feed.pushChat("think", "because of the bitrate", true);
    feed.flushReveal();
    expect(feed.el.querySelectorAll(".row.think")).toHaveLength(1);
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("because of the bitrate");
  });

  it("keeps one think row while packets arrive", () => {
    const feed = overlay("both");
    feed.pushChat("think", "plan:\n", true);
    const t = 1_700_000_000;
    const pkt: Packet = [t, "out", "8.8.8.8", "dns", "udp/53", 80, "wlan0", "A www.example.com", "53", "192.168.86.4"];
    const msg: TrafficMsg = {
      ip: "@lan",
      peer: null,
      ts: t,
      packets: [pkt],
      window: null,
      summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    };
    (feed as unknown as { ingest(m: TrafficMsg): void }).ingest(msg);
    feed.pushChat("think", "check nest\n", true);
    feed.flushReveal();
    const think = [...feed.el.querySelectorAll(".row.think")];
    expect(think).toHaveLength(1);
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("plan:");
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("check nest");
    expect(feed.el.querySelector(".feed-ticker")?.lastElementChild).toBe(think[0]);
    expect([...feed.el.querySelectorAll(".row")].some((r) => !r.classList.contains("chat"))).toBe(true);
  });

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
});

describe("feed type size and auto-scroll", () => {
  function mockTicker(feed: LiveFeed, height = 80, content = 400): () => number {
    const ticker = feed.el.querySelector(".feed-ticker") as HTMLDivElement;
    Object.defineProperty(ticker, "clientHeight", { configurable: true, get: () => height });
    Object.defineProperty(ticker, "scrollHeight", { configurable: true, get: () => content });
    let top = 0;
    Object.defineProperty(ticker, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = Number(v); },
    });
    return () => top;
  }

  it("applies --feed-size and clamps", () => {
    const feed = overlay();
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "transcript", layout: "ticker", textSize: 18 });
    expect(feed.el.style.getPropertyValue("--feed-size")).toBe("18px");
    feed.setConfig({ ...DEFAULT_FEED, on: true, source: "transcript", layout: "ticker", textSize: 99 });
    expect(feed.el.style.getPropertyValue("--feed-size")).toBe("20px");
  });

  it("does not wipe live chat rows when history reseeds", () => {
    const feed = overlay();
    feed.pushChat("you", "live ask");
    feed.pushChat("agent", "live reply");
    feed.seedTranscript([
      { role: "user", content: "stale" },
      { role: "assistant", content: "would replace" },
    ]);
    const texts = [...feed.el.querySelectorAll(".row .tx")].map((el) => el.textContent?.trim());
    expect(texts).toEqual(["live ask", "live reply"]);
  });

  it("queues traffic lines below the viewport until the ticker scrolls to them", () => {
    const feed = overlay("traffic");
    const top = mockTicker(feed);
    const t = 1_700_000_000;
    const pkt: Packet = [t, "out", "8.8.8.8", "dns", "udp/53", 80, "wlan0", "A www.example.com", "53", "192.168.86.4"];
    (feed as unknown as { ingest(m: TrafficMsg): void }).ingest({
      ip: "@lan", peer: null, ts: t, packets: [pkt],
      window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] },
    });
    expect(top()).toBe(0);
    feed.stepClock(0.016);
    expect(top()).toBeGreaterThan(0);
    expect(top()).toBeLessThan(400);
  });

  it("snaps seeded history, then queues live tokens below until catch-up", () => {
    const feed = overlay();
    const top = mockTicker(feed);
    feed.seedTranscript([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(top()).toBe(400);
    feed.pushChat("agent", " more tokens", true);
    expect(top()).toBe(400);
  });

  it("keeps following the transcript as agent tokens arrive", () => {
    const feed = overlay();
    const top = mockTicker(feed);
    feed.seedTranscript([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(top()).toBe(400);
    const ticker = feed.el.querySelector(".feed-ticker") as HTMLDivElement;
    ticker.scrollTop = 10;
    ticker.dispatchEvent(new Event("scroll"));
    feed.pushChat("think", "planning\n", true);
    expect(top()).toBe(10);
    feed.setThinking(true);
    expect(feed.el.querySelector(".feed-hint")?.textContent).toBe("thinking…");
    feed.pushChat("agent", "next line", true);
    expect(top()).toBe(10);
    feed.stepClock(2);
    expect(top()).toBe(320);
  });

  it("marks listening and keeps following the ticker", () => {
    const feed = overlay();
    const top = mockTicker(feed);
    feed.seedTranscript([{ role: "user", content: "hi" }]);
    feed.setListening(true);
    expect(feed.el.classList.contains("listening")).toBe(true);
    expect(feed.el.querySelector(".feed-hint")?.textContent).toMatch(/listening/i);
    expect(feed.ask.placeholder).toMatch(/send/i);
    expect(top()).toBe(400);
    feed.setListening(false);
    expect(feed.el.classList.contains("listening")).toBe(false);
  });

  it("buffers streamed agent text until the typewriter catches up", () => {
    const feed = overlay();
    feed.pushChat("agent", "Hello there, friend. ", true);
    expect(feed.el.querySelector(".row.agent .tx")?.textContent).toBe("");
    feed.stepClock(0.05);
    const mid = feed.el.querySelector(".row.agent .tx")?.textContent || "";
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan("Hello there, friend. ".length);
    feed.flushReveal();
    expect(feed.el.querySelector(".row.agent .tx")?.textContent).toContain("Hello there");
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

  it("eases the ticker toward the latest line while the buffer grows", () => {
    const feed = overlay();
    const ticker = feed.el.querySelector(".feed-ticker") as HTMLDivElement;
    Object.defineProperty(ticker, "clientHeight", { configurable: true, get: () => 80 });
    let height = 200;
    Object.defineProperty(ticker, "scrollHeight", { configurable: true, get: () => height });
    let top = 100;
    Object.defineProperty(ticker, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = Number(v); },
    });
    feed.pushChat("agent", "Hello world. ", true);
    expect(top).toBe(100);
    height = 400;
    feed.stepClock(0.016);
    expect(top).toBeGreaterThan(100);
    expect(top).toBeLessThan(140);
  });

  it("notifies onDisplay as characters appear and when the stream locks", () => {
    const feed = overlay();
    const seen: { shown: string; done: boolean }[] = [];
    feed.onDisplay = (info) => { if (info.role === "agent") seen.push({ shown: info.shown, done: info.done }); };
    feed.pushChat("agent", "Hello world.", true);
    feed.stepClock(1);
    feed.lockStream();
    expect(seen.some((s) => s.shown.includes("Hello") && !s.done)).toBe(true);
    expect(seen.at(-1)?.done).toBe(true);
    expect(seen.at(-1)?.shown).toBe("Hello world.");
  });
});
