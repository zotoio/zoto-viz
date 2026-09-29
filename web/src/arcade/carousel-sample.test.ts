import { afterEach, describe, expect, it } from "vitest";
import type { NetScene } from "../graph/scene";
import type { SourceLive } from "../core/sources";
import { CarouselView } from "./carousel";

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as unknown as NetScene;
}

/** Feeds a snapshot the way Stage3D.update does once running (no WebGL needed). */
class CarouselHarness extends CarouselView {
  feed(sources: Record<string, SourceLive & { demo?: boolean }>): void {
    (this as unknown as { msg: unknown }).msg = { sources };
    this.onSnapshot();
  }
  slideImages(): string[] {
    return (this["slides" as keyof this] as unknown as Array<{ image?: string }>).map((s) => s.image ?? "");
  }
}

const nasa: SourceLive = {
  id: "nasa", kind: "rss", label: "NASA image of the day", ok: true,
  items: [{ title: "Hubble Spots Chaotic Secret in Galaxy", image: "https://www.nasa.gov/wp-content/uploads/2026/09/55534741297-34e5a9d414-o.jpg" }],
};
const commons: SourceLive = {
  id: "commons-potd", kind: "rss", label: "Commons picture of the day", ok: true,
  items: [{ title: "Wikimedia Commons picture of the day for September 24", image: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/x.jpg/960px-x.jpg" }],
};

describe("CarouselView per-source stills", () => {
  const hosts: HTMLElement[] = [];
  afterEach(() => {
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });
  function make(): CarouselHarness {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    return new CarouselHarness(host, mockScene());
  }

  it("drops the previous source's slides when the new source has no stills (apod after nasa)", () => {
    const view = make();
    const apodDown: SourceLive = { id: "apod", kind: "http", label: "APOD", ok: false, error: "http 429" };
    view.feed({ nasa, apod: apodDown });
    expect(view.slideImages()[0]).toContain("www.nasa.gov");
    view.setBind({ source: "apod", filter: "has-image" });
    expect(view.slideImages()).toEqual([]);
  });

  it("drops the previous source's slides (earth-iotd after commons-potd)", () => {
    const view = make();
    const earthDown: SourceLive = { id: "earth-iotd", kind: "rss", label: "Earth Observatory", ok: false, error: "not well-formed" };
    view.setBind({ source: "commons-potd", filter: "has-image" });
    view.feed({ "commons-potd": commons, "earth-iotd": earthDown });
    expect(view.slideImages()[0]).toContain("wikimedia.org");
    view.setBind({ source: "earth-iotd", filter: "has-image" });
    expect(view.slideImages()).toEqual([]);
  });

  it("shows a visible sample-pictures line only while the bound source serves its demo stills", () => {
    const view = make();
    const apodSample = {
      id: "apod", kind: "http", label: "APOD", ok: true, feed: false, demo: true,
      items: [{ title: "A Zodiacal Night", image: "https://apod.nasa.gov/apod/image/2609/2026-09-09ZodiacalLightHSP.jpg" }],
    };
    view.setBind({ source: "apod", filter: "has-image" });
    view.feed({ nasa, apod: apodSample });
    expect(view.sampleEl.hidden).toBe(false);
    expect(view.sampleEl.textContent).toMatch(/sample pictures/i);
    expect(view.sampleEl.isConnected).toBe(true);
    expect(view.slideImages()).toEqual(["https://apod.nasa.gov/apod/image/2609/2026-09-09ZodiacalLightHSP.jpg"]);
    view.setBind({ source: "nasa", filter: "has-image" });
    expect(view.sampleEl.hidden).toBe(true);
    expect(view.slideImages()[0]).toContain("www.nasa.gov");
  });
});
