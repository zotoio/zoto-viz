import { describe, expect, it } from "vitest";
import {
  CAROUSEL_LAYOUTS,
  CAROUSEL_TRANSITIONS,
  carouselArrival,
  carouselByline,
  carouselVariant,
  stillFit,
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

describe("stillFit (fit to height)", () => {
  it("crops the sides when the still is wider than the panel", () => {
    expect(stillFit(1792, 1024, 1400, 900)).toBe("cover");
    expect(stillFit(1792, 1024, 360, 640)).toBe("cover");
  });
  it("pads the sides when the still is narrower than the panel", () => {
    expect(stillFit(1792, 1024, 1400, 598)).toBe("contain");
    expect(stillFit(800, 1200, 1400, 740)).toBe("contain");
  });
  it("defaults to cover before the still has loaded", () => {
    expect(stillFit(0, 0, 800, 600)).toBe("cover");
  });
});

describe("carousel open-on-site button", () => {
  it("labels an https page by host and carries page through slides", async () => {
    const { carouselOpenLabel, carouselSlides } = await import("./carousel-slides");
    expect(carouselOpenLabel("https://botz.ai/#2026-11-03-08")).toBe("Open on botz.ai");
    expect(carouselOpenLabel("http://botz.ai/")).toBeNull();
    expect(carouselOpenLabel(undefined)).toBeNull();
    const [s] = carouselSlides([{ id: "botz:0", label: "Botz", text: "T", image: "https://botz.ai/a.png", page: "https://botz.ai/#k" }]);
    expect(s?.page).toBe("https://botz.ai/#k");
  });

  it("CarouselView points the button at the current slide's page", async () => {
    const { CarouselView } = await import("./carousel");
    const paint = Reflect.get(CarouselView.prototype, "paintCaption") as (this: unknown, s: unknown) => void;
    const el = (tag: string) => document.createElement(tag);
    const self = {
      capTitle: el("strong"), capBody: el("span"), capMeta: el("span"), stillEl: el("figure"),
      openEl: el("a") as HTMLAnchorElement, capEl: el("figcaption"), sampleEl: el("div"),
    };
    paint.call(self, { id: "a", title: "One", label: "Botz", page: "https://botz.ai/#a" });
    expect(self.openEl.hidden).toBe(false);
    expect(self.openEl.href).toBe("https://botz.ai/#a");
    paint.call(self, { id: "b", title: "Two", label: "Botz", page: "https://botz.ai/#b" });
    expect(self.openEl.href).toBe("https://botz.ai/#b");
    paint.call(self, { id: "c", title: "Three", label: "NASA" });
    expect(self.openEl.hidden).toBe(true);
  });
});
