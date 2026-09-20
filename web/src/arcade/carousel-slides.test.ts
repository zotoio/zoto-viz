import { describe, expect, it } from "vitest";
import {
  carouselCaption,
  carouselCaptionParts,
  carouselSlides,
  carouselTickerSeconds,
  carouselTickerText,
  headlinesFromSources,
  proxiedStill,
} from "./carousel-slides";

describe("carousel-slides", () => {
  it("keeps pictured headlines", () => {
    const slides = carouselSlides([
      { id: "hn:0", label: "Hacker News", text: "A story" },
      { id: "nasa:0", label: "NASA image of the day", text: "Nebula", image: "https://www.nasa.gov/a.jpg" },
      { id: "nasa:1", label: "NASA image of the day", text: "Moon", image: "https://www.nasa.gov/b.jpg" },
    ]);
    expect(slides).toHaveLength(2);
    expect(slides[0]!.title).toBe("Nebula");
    expect(slides[0]!.image).toContain("nasa.gov");
  });

  it("stays empty when stills are missing", () => {
    expect(carouselSlides([
      { id: "hn:0", label: "Hacker News", text: "Only text" },
      { id: "nasa:0", label: "NASA image of the day", text: "Title only" },
    ])).toEqual([]);
  });

  it("reads pictured items even when a text feed is listed first", () => {
    const headlines = headlinesFromSources({
      hn: {
        id: "hn", kind: "rss", label: "Hacker News", ok: true,
        items: Array.from({ length: 20 }, (_, i) => ({ title: `Story ${i}` })),
      },
      nasa: {
        id: "nasa", kind: "rss", label: "NASA image of the day", ok: true,
        items: [{ title: "Nebula", image: "https://www.nasa.gov/a.jpg" }],
      },
    });
    const slides = carouselSlides(headlines);
    expect(slides[0]!.title).toBe("Nebula");
    expect(slides[0]!.image).toContain("nasa.gov");
  });

  it("proxies stills through the monitor", () => {
    expect(proxiedStill("https://www.nasa.gov/a.jpg")).toBe(
      "/api/sources/image?url=https%3A%2F%2Fwww.nasa.gov%2Fa.jpg",
    );
  });

  it("keeps NASA captions intact on each still", () => {
    const headlines = headlinesFromSources({
      nasa: {
        id: "nasa", kind: "rss", label: "NASA image of the day", ok: true,
        items: [{
          title: "A long NASA caption that should stay intact on the ticker and slides",
          summary: "<p>A superbubble in the Large Magellanic Cloud</p>",
          image: "https://www.nasa.gov/a.jpg",
        }],
      },
    });
    const slides = carouselSlides(headlines);
    expect(slides[0]!.title).toContain("long NASA caption");
    expect(slides[0]!.caption).toContain("superbubble");
    expect(carouselCaptionParts(slides[0]!)).toEqual({
      title: expect.stringContaining("long NASA caption"),
      body: expect.stringContaining("superbubble"),
    });
    expect(carouselCaption(slides[0]!)).toContain(" — ");
    const line = carouselTickerText(slides);
    expect(line).toContain("long NASA caption");
    expect(line).toContain("superbubble");
    expect(carouselTickerSeconds(line)).toBeGreaterThanOrEqual(56);
  });
});
