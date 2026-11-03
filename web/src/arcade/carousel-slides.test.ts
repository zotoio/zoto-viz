import { describe, expect, it } from "vitest";
import {
  CAROUSEL_LAYOUTS,
  CAROUSEL_TRANSITIONS,
  carouselArrival,
  carouselByline,
  carouselVariant,
  carouselCaption,
  carouselCaptionParts,
  carouselSlides,
  carouselTickerSeconds,
  carouselTickerText,
  headlinesFromSources,
  proxiedStill,
} from "./carousel-slides";

describe("carousel-slides", () => {
  it("keeps a deep pictured page", () => {
    const slides = carouselSlides(Array.from({ length: 40 }, (_, i) => ({
      id: `nasa:${i}`,
      label: "NASA",
      text: `Shot ${i}`,
      image: `https://www.nasa.gov/${i}.jpg`,
    })));
    expect(slides).toHaveLength(40);
  });

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

  it("carries source and author through to slides", () => {
    const slides = carouselSlides(headlinesFromSources({
      botz: {
        id: "botz", kind: "http", label: "Botz.ai daily", ok: true,
        items: [{ title: "Model ships", image: "https://botz.ai/cache/images/a.png", author: "Jo Writer", source: "Example News" }],
      },
    }, { source: "botz" }));
    expect(slides[0]!.author).toBe("Jo Writer");
    expect(slides[0]!.origin).toBe("Example News");
    expect(carouselByline(slides[0]!)).toBe("Example News · Jo Writer");
  });

  it("byline falls back to whichever part exists", () => {
    expect(carouselByline({ origin: "Site" })).toBe("Site");
    expect(carouselByline({ author: "Ann" })).toBe("Ann");
    expect(carouselByline({})).toBe("");
    expect(carouselByline({ origin: "Same", author: "same" })).toBe("Same");
  });

  it("varies layout and transition across slides and cycles", () => {
    const layouts = new Set<string>();
    const transitions = new Set<string>();
    for (let i = 0; i < 24; i++) {
      for (let c = 0; c < 3; c++) {
        const v = carouselVariant(`botz:${i}`, c);
        expect(CAROUSEL_LAYOUTS).toContain(v.layout);
        expect(CAROUSEL_TRANSITIONS).toContain(v.transition);
        layouts.add(v.layout);
        transitions.add(v.transition);
      }
    }
    expect(layouts.size).toBeGreaterThanOrEqual(4);
    expect(transitions.size).toBeGreaterThanOrEqual(5);
    expect(carouselVariant("botz:3", 7)).toEqual(carouselVariant("botz:3", 7));
  });

  it("arrival ends fully in place for every transition", () => {
    for (const kind of CAROUSEL_TRANSITIONS) {
      const start = carouselArrival(kind, 0);
      const end = carouselArrival(kind, 1);
      expect(start.opacity).toBe(0);
      expect(end.opacity).toBe(1);
      expect(end.filter === "" || end.filter === "blur(0.00px)").toBe(true);
      expect(end.transform === "" || /\(0\.00%\)|scale\(1\.0000\)/.test(end.transform)).toBe(true);
    }
    expect(carouselArrival("iris", 0.5).clipPath).toMatch(/^circle\(/);
  });
});
