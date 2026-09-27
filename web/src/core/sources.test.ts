import { describe, expect, it } from "vitest";
import {
  FEED_HEADLINE_LIMIT, illustratedSourceBind, oneLineTitle, sourceHeadlines, stripMarkup, type SourceLive,
} from "./sources";

describe("sourceHeadlines", () => {
  it("puts news, journal, and files on the ticker as one-line titles", () => {
    const sources: Record<string, SourceLive> = {
      hn: {
        id: "hn", kind: "rss", label: "HN", ok: true, feed: true,
        items: [
          { title: "One\nTwo  lines", summary: "<p>First blurb</p>", image: "https://www.nasa.gov/iotd.jpg" },
          { title: "Two" },
        ],
      },
      nasa: {
        id: "nasa", kind: "rss", label: "NASA image of the day", ok: true, feed: true,
        items: [{ title: "Nebula", image: "https://www.nasa.gov/a.jpg" }],
      },
      guardian: {
        id: "guardian", kind: "rss", label: "Guardian world", ok: true, feed: true,
        items: [{ title: "World" }],
      },
      down: { id: "down", kind: "rss", label: "X", ok: false, error: "timeout", items: [{ title: "Nope" }] },
      quiet: { id: "quiet", kind: "file", label: "Notes", ok: true, feed: true, text: "hello\nworld" },
      kmsg: { id: "kmsg", kind: "kmsg", label: "Kernel ring", ok: true, feed: true, text: "usb 1-1: new device" },
      off: { id: "off", kind: "rss", label: "Off", ok: true, paused: true, items: [{ title: "Hidden" }] },
    };
    expect(sourceHeadlines(sources, 8)).toEqual([
      {
        id: "hn:0", label: "HN", text: "One Two lines", kind: "rss",
        summary: "First blurb", image: "https://www.nasa.gov/iotd.jpg",
      },
      { id: "hn:1", label: "HN", text: "Two", kind: "rss" },
      {
        id: "nasa:0", label: "NASA image of the day", text: "Nebula", kind: "rss",
        image: "https://www.nasa.gov/a.jpg",
      },
      { id: "guardian:0", label: "Guardian world", text: "World", kind: "rss" },
      { id: "quiet:0", label: "Notes", text: "hello", kind: "file" },
      { id: "quiet:1", label: "Notes", text: "world", kind: "file" },
      { id: "kmsg:0", label: "Kernel ring", text: "usb 1-1: new device", kind: "kmsg" },
    ]);
  });

  it("walks HTTP JSON string leaves on the ticker and when a view binds that source", () => {
    const sources: Record<string, SourceLive> = {
      api: {
        id: "api", kind: "http", label: "API", ok: true, feed: true,
        json: { title: "Roster", users: [{ name: "Ada" }] },
      },
    };
    expect(sourceHeadlines(sources, 8).map((h) => h.text)).toEqual(
      expect.arrayContaining(["Roster", "Ada"]),
    );
    expect(sourceHeadlines(sources, 8, { source: "api" }).map((h) => h.text)).toEqual(
      expect.arrayContaining(["Roster", "Ada"]),
    );
    expect(sourceHeadlines(sources, 8, { source: "api" }).every((h) => h.kind === "http")).toBe(true);
  });

  it("keeps a deep pictured page when a view binds it", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      title: `Shot ${i}`,
      image: `https://www.nasa.gov/${i}.jpg`,
    }));
    const sources: Record<string, SourceLive> = {
      nasa: { id: "nasa", kind: "rss", label: "NASA", ok: true, feed: false, items },
    };
    expect(sourceHeadlines(sources)).toEqual([]);
    expect(sourceHeadlines(sources, FEED_HEADLINE_LIMIT, { source: "nasa" })).toHaveLength(40);
    expect(sourceHeadlines(sources, FEED_HEADLINE_LIMIT, { filter: "has-image" })).toHaveLength(40);
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

  it("strips HTML from article blurbs", () => {
    expect(stripMarkup("<p>Hello&nbsp;<b>world</b> &amp; news</p>")).toBe("Hello world & news");
  });

  it("mixes news sources on the unbound ticker instead of filling it with one feed", () => {
    const nasaItems = Array.from({ length: 40 }, (_, i) => ({ title: `Shot ${i}` }));
    const sources: Record<string, SourceLive> = {
      nasa: { id: "nasa", kind: "rss", label: "NASA", ok: true, feed: true, items: nasaItems },
      hn: { id: "hn", kind: "rss", label: "HN", ok: true, feed: true, items: [{ title: "Show HN" }] },
    };
    const texts = sourceHeadlines(sources, 64).map((h) => `${h.label}:${h.text}`);
    expect(texts.filter((t) => t.startsWith("NASA:")).length).toBe(8);
    expect(texts).toContain("HN:Show HN");
  });
});
