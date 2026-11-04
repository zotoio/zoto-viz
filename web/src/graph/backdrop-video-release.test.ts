/**
 * A probed sky video that is never cached (stale load, zero width, or error) must drop its media
 * player: otherwise each superseded plate keeps a decoder (and audio sink) alive until GC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Backdrop } from "./backdrop";

let made: HTMLMediaElement[] = [];
beforeEach(() => {
  made = [];
  // loadPhotoVideo calls load() on each new probe element; capture them there
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) {
    if (!made.includes(this)) made.push(this);
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

type Sky = { load(url: string, gen: number, onMiss: () => void): void; setGen(n: number): void };

function probe(): { sky: Sky; el: () => HTMLMediaElement } {
  const b = new Backdrop();
  const fn: unknown = Reflect.get(b, "loadPhotoVideo");
  const sky: Sky = {
    load: (url, gen, onMiss) => { if (typeof fn === "function") Reflect.apply(fn, b, [url, gen, onMiss]); },
    setGen: (n) => { Reflect.set(b, "photoLoadGen", n); },
  };
  return { sky, el: () => made[made.length - 1] };
}

describe("loadPhotoVideo releases unused probe elements", () => {
  it("stale load (a newer sky was picked) releases the element", () => {
    const { sky, el } = probe();
    sky.setGen(5);
    sky.load("/skies/a.webm", 4, () => undefined);
    const v = el();
    expect(v.getAttribute("src")).toBe("/skies/a.webm");
    v.dispatchEvent(new Event("loadeddata"));
    expect(v.hasAttribute("src")).toBe(false);
  });

  it("zero-width video releases the element and falls back", () => {
    const { sky, el } = probe();
    sky.setGen(1);
    const miss = vi.fn();
    sky.load("/skies/b.webm", 1, miss);
    const v = el();
    Object.defineProperty(v, "videoWidth", { value: 0, configurable: true });
    v.dispatchEvent(new Event("loadeddata"));
    expect(miss).toHaveBeenCalled();
    expect(v.hasAttribute("src")).toBe(false);
  });

  it("error releases the element", () => {
    const { sky, el } = probe();
    sky.setGen(1);
    sky.load("/skies/c.webm", 1, () => undefined);
    const v = el();
    v.dispatchEvent(new Event("error"));
    expect(v.hasAttribute("src")).toBe(false);
  });
});
