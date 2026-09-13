import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES, FEED_SOURCES, feedViewShift, LiveFeed } from "./feed";
import type { NetScene } from "../graph/scene";

const feeds: LiveFeed[] = [];

function overlay(): LiveFeed {
  const host = document.createElement("div");
  document.body.append(host);
  const feed = new LiveFeed(host, { pulseNow: { level: 0 } } as NetScene);
  feeds.push(feed);
  feed.setConfig({ ...DEFAULT_FEED, on: true, source: "transcript", layout: "ticker" });
  return feed;
}

afterEach(() => {
  for (const f of feeds) f.setConfig({ ...DEFAULT_FEED, on: false });
  feeds.length = 0;
  document.body.replaceChildren();
});

describe("feed defaults", () => {
  it("is on with shipped layouts and a traffic source", () => {
    expect(DEFAULT_FEED.on).toBe(true);
    expect(DEFAULT_FEED.source).toBe("traffic");
    expect(FEED_LAYOUTS.map((o) => o.value)).toEqual(["ticker", "bars", "both"]);
    expect(FEED_SCOPES.map((o) => o.value)).toContain("lan");
    expect(FEED_SOURCES.map((o) => o.value)).toEqual(["traffic", "transcript", "both"]);
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
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("1. greet");
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("2. wait");
  });

  it("streams newlines into the same think line", () => {
    const feed = overlay();
    feed.pushChat("think", "Analyze the user input:\n", true);
    feed.pushChat("think", "they said hi\nGoal: reply", true);
    const think = [...feed.el.querySelectorAll(".row.think")];
    expect(think).toHaveLength(1);
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Analyze the user input:");
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Goal: reply");
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
    expect(pending?.textContent).toBe("thinking…");
    feed.pushChat("think", "checking talkers\n", true);
    expect(feed.el.querySelector(".row.think.pending")).toBeNull();
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("checking talkers");
    feed.setThinking(false);
    expect(feed.el.classList.contains("thinking")).toBe(false);
    expect(feed.el.querySelector(".row.think .tx")?.textContent).toContain("checking talkers");

    const quiet = overlay();
    quiet.setThinking(true);
    quiet.pushChat("agent", "hi", true);
    expect(quiet.el.querySelector(".row.think")).toBeNull();
    expect(quiet.el.querySelector(".row.agent .tx")?.textContent).toBe("hi");
    quiet.setThinking(false);
    expect(quiet.el.getAttribute("aria-busy")).toBe("false");
  });
});
