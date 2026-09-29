import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import type { SourceLive } from "../core/sources";
import { IMAGE_RETRY_MS, IMAGE_TIMEOUT_MS, stillSrc } from "../core/load-image";
import { CarouselView } from "./carousel";

/**
 * QA batch D: picking APOD showed NASA's picture under APOD's caption. NASA's load (or its
 * retry) was still running on the shared <img> when the source switched, so it wrote NASA's
 * src later and revealed it; a failed APOD load also left NASA's picture on the element.
 */

const NASA_IMG = "https://www.nasa.gov/wp-content/uploads/2026/09/55534901810-95d2f06788-o.jpg";
const APOD_IMG = "https://apod.nasa.gov/apod/image/2609/McGetchin_LRO_1080.jpg";
const NASA_SRC = stillSrc(NASA_IMG);
const APOD_SRC = stillSrc(APOD_IMG);

const nasa: SourceLive = {
  id: "nasa", kind: "rss", label: "NASA image of the day", ok: true,
  items: [{ title: "Space Station View of Earth at Night", image: NASA_IMG }],
};
const apod: SourceLive = {
  id: "apod", kind: "http", label: "Astronomy Picture of the Day", ok: true,
  items: [{ title: "A New Lunar Crater: McGetchin", image: APOD_IMG }],
};

function mockScene(): NetScene {
  return { pulseNow: { level: 0 }, selectedIp: "", deviceOf: () => undefined, selectIp: () => {} } as unknown as NetScene;
}

type Img = HTMLImageElement & { ready?: boolean };

/** Every `src` written to the carousel's two <img> elements, in order. */
const writes: string[] = [];

/** happy-dom never fetches images: the test decides when each load lands or fails. */
function instrument(el: Img): void {
  const proto = Object.getPrototypeOf(el) as object;
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")
    ?? Object.getOwnPropertyDescriptor(proto, "src")!;
  Object.defineProperty(el, "src", {
    configurable: true,
    get() { return srcDesc.get!.call(el); },
    set(v: string) { writes.push(v); el.ready = false; srcDesc.set!.call(el, v); },
  });
  Object.defineProperty(el, "complete", { configurable: true, get: () => Boolean(el.ready) || !el.getAttribute("src") });
  Object.defineProperty(el, "naturalWidth", { configurable: true, get: () => (el.ready && el.getAttribute("src") ? 640 : 0) });
}

class Harness extends CarouselView {
  feed(sources: Record<string, SourceLive>): void {
    (this as unknown as { msg: unknown }).msg = { sources };
    this.onSnapshot();
  }
  imgs(): Img[] {
    return [this["imgA" as keyof this], this["imgB" as keyof this]] as unknown as Img[];
  }
}

function srcOf(el: HTMLImageElement): string {
  return el.getAttribute("src") ?? "";
}
const isNasa = (s: string): boolean => s.startsWith(NASA_SRC);

/** Pictures a viewer could see: an <img> holding a src and not faded out. */
function visible(view: Harness): string[] {
  return view.imgs().filter((el) => srcOf(el) && el.style.opacity !== "0").map(srcOf);
}

/** The pending load on whichever <img> currently holds `prefix` lands (ok) or fails. */
function settle(view: Harness, prefix: string, ok: boolean): void {
  const el = view.imgs().find((i) => srcOf(i).startsWith(prefix));
  if (!el) return;
  el.ready = ok;
  el.dispatchEvent(new Event(ok ? "load" : "error"));
}

const flush = (ms = 0): Promise<void> => vi.advanceTimersByTimeAsync(ms);

describe("CarouselView cancels the old source's image loads on a source switch", () => {
  const hosts: HTMLElement[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    writes.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });
  function make(): Harness {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const view = new Harness(host, mockScene());
    for (const el of view.imgs()) instrument(el);
    return view;
  }

  it("a NASA load still in flight at the switch never lands on the <img> (apod after nasa)", async () => {
    const view = make();
    view.feed({ nasa, apod });
    const loading = view.imgs().find((el) => isNasa(srcOf(el)))!;
    expect(loading).toBeDefined();
    // The browser's callback for NASA's in-flight request, as it stood before the switch.
    const lateNasaLoad = loading.onload;
    const lateNasaError = loading.onerror;
    const mark = writes.length;
    view.setBind({ source: "apod", filter: "has-image" });
    // NASA's response arrives late (handlers captured pre-switch), then every timer runs out.
    lateNasaLoad?.call(loading, new Event("load"));
    lateNasaError?.call(loading, new Event("error"));
    await flush(IMAGE_RETRY_MS * 4);
    settle(view, NASA_SRC, true);
    await flush(IMAGE_TIMEOUT_MS + IMAGE_RETRY_MS * 4);
    settle(view, NASA_SRC, true);
    await flush(IMAGE_TIMEOUT_MS * 3);
    expect(writes.slice(mark).filter(isNasa)).toEqual([]);
    expect(view.imgs().map(srcOf).filter(isNasa)).toEqual([]);
    expect(visible(view).filter(isNasa)).toEqual([]);
  });

  it("a NASA retry timer pending at the switch is cancelled (apod after nasa)", async () => {
    const view = make();
    view.feed({ nasa, apod });
    settle(view, NASA_SRC, false); // first NASA attempt fails -> retry timer armed
    await flush(0);
    const mark = writes.length;
    view.setBind({ source: "apod", filter: "has-image" });
    await flush(IMAGE_RETRY_MS * 4); // the old retry would fire here
    settle(view, NASA_SRC, true); // ...and its late load would land
    await flush(0);
    expect(writes.slice(mark).filter(isNasa)).toEqual([]);
    expect(visible(view).filter(isNasa)).toEqual([]);
    // APOD still loads normally afterwards.
    settle(view, APOD_SRC, true);
    await flush(0);
    expect(visible(view)).toEqual([APOD_SRC]);
  });

  it("a failed APOD load leaves no NASA picture on screen (blank tile, APOD caption)", async () => {
    const view = make();
    view.feed({ nasa, apod });
    settle(view, NASA_SRC, true);
    await flush(0);
    expect(visible(view)).toEqual([NASA_SRC]);
    view.setBind({ source: "apod", filter: "has-image" });
    for (let i = 0; i < 3; i++) {
      settle(view, APOD_SRC, false);
      await flush(IMAGE_RETRY_MS * 4);
    }
    await flush(IMAGE_TIMEOUT_MS * 3);
    expect(view.imgs().map(srcOf).filter(isNasa)).toEqual([]);
    expect(visible(view)).toEqual([]);
    // The failed element is empty, not showing its previous picture or alt text.
    for (const el of view.imgs()) {
      expect(srcOf(el)).toBe("");
      expect(el.alt).toBe("");
    }
    expect(hosts[hosts.length - 1]!.textContent).toContain("A New Lunar Crater: McGetchin");
  });
});
