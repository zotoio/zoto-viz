import { describe, expect, it } from "vitest";
import {
  countEligibleSourceHeadlines,
  FEED_HEADLINE_LIMIT,
  illustratedSourceBind,
  sourceHeadlines,
  stripMarkup,
  type SourceLive,
} from "./sources";

describe("sourceHeadlines", () => {
  it("takes RSS titles and skips paused or failed sources", () => {
    const sources: Record<string, SourceLive> = {
      hn: {
        id: "hn", kind: "rss", label: "HN", ok: true, feed: true,
        items: [
          { title: "One", summary: "<p>First blurb</p>", image: "https://www.nasa.gov/iotd.jpg" },
          { title: "Two" },
        ],
      },
      down: { id: "down", kind: "rss", label: "X", ok: false, error: "timeout", items: [{ title: "Nope" }] },
      quiet: { id: "quiet", kind: "file", label: "Notes", ok: true, feed: true, text: "hello\nworld" },
      off: { id: "off", kind: "rss", label: "Off", ok: true, paused: true, items: [{ title: "Hidden" }] },
    };
    expect(sourceHeadlines(sources, 8)).toEqual([
      { id: "hn:0", label: "HN", text: "One", kind: "rss", summary: "First blurb", image: "https://www.nasa.gov/iotd.jpg" },
      { id: "hn:1", label: "HN", text: "Two", kind: "rss" },
      { id: "quiet:0", label: "Notes", text: "hello", kind: "file" },
      { id: "quiet:1", label: "Notes", text: "world", kind: "file" },
    ]);
  });

  it("walks HTTP JSON string leaves", () => {
    const sources: Record<string, SourceLive> = {
      api: {
        id: "api", kind: "http", label: "API", ok: true, feed: true,
        json: { title: "Roster", users: [{ name: "Ada" }] },
      },
    };
    expect(sourceHeadlines(sources, 8).map((h) => h.text)).toEqual(
      expect.arrayContaining(["Roster", "Ada"]),
    );
    expect(sourceHeadlines(sources, 8).every((h) => h.kind === "http")).toBe(true);
  });

  it("keeps a deep pictured page by default", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      title: `Shot ${i}`,
      image: `https://www.nasa.gov/${i}.jpg`,
    }));
    const sources: Record<string, SourceLive> = {
      nasa: { id: "nasa", kind: "rss", label: "NASA", ok: true, feed: true, items },
    };
    expect(sourceHeadlines(sources)).toHaveLength(40);
    expect(FEED_HEADLINE_LIMIT).toBeGreaterThanOrEqual(40);
  });

  it("returns nothing without a map", () => {
    expect(sourceHeadlines(undefined)).toEqual([]);
  });

  it("binds one source and pictured items", () => {
    const sources: Record<string, SourceLive> = {
      hn: {
        id: "hn", kind: "rss", label: "HN", ok: true, feed: true,
        items: [{ title: "One" }, { title: "Pic", image: "https://example.com/a.jpg" }],
      },
      nasa: {
        id: "nasa", kind: "rss", label: "NASA", ok: true, feed: true,
        items: [{ title: "Nebula", image: "https://www.nasa.gov/a.jpg" }],
      },
    };
    expect(sourceHeadlines(sources, 8, { source: "nasa" }).map((h) => h.text)).toEqual(["Nebula"]);
    expect(sourceHeadlines(sources, 8, { source: "hn", filter: "has-image" }).map((h) => h.text)).toEqual(["Pic"]);
    expect(sourceHeadlines(sources, 8, illustratedSourceBind({
      source: "hn",
      filter: "has-image",
    })).map((h) => h.text)).toEqual(["One", "Pic"]);
  });

  it("countEligible matches uncapped sourceHeadlines length", () => {
    const sources: Record<string, SourceLive> = {
      feed: {
        id: "feed",
        kind: "rss",
        label: "Feed",
        ok: true,
        feed: true,
        items: Array.from({ length: 72 }, (_, i) => ({ title: `Item ${i}` })),
      },
    };
    expect(countEligibleSourceHeadlines(sources)).toBe(72);
    expect(countEligibleSourceHeadlines(sources)).toBe(
      sourceHeadlines(sources, Number.MAX_SAFE_INTEGER).length,
    );
  });

  it("strips HTML from article blurbs", () => {
    expect(stripMarkup("<p>Hello&nbsp;<b>world</b> &amp; news</p>")).toBe("Hello world & news");
  });
});
