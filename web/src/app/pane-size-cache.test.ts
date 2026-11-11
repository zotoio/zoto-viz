import { describe, expect, it } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import { PaneSizeCache } from "./pane-size-cache";

function fakeRo() {
  const state: { cb?: (e: readonly { target: Element; contentRect: { width: number; height: number } }[]) => void; observed: Element[] } = { observed: [] };
  class RO {
    constructor(cb: NonNullable<typeof state.cb>) { state.cb = cb; }
    observe(el: Element) { state.observed.push(el); }
    unobserve(el: Element) { state.observed = state.observed.filter((x) => x !== el); }
    disconnect() { state.observed = []; }
  }
  return { RO, state };
}

function el(w: number, h: number) {
  let reads = 0;
  const o = mockPartial<Element & { clientWidth: number; clientHeight: number }>({ get clientWidth() { reads++; return w; }, get clientHeight() { reads++; return h; } });
  return { o, reads: () => reads };
}

describe("PaneSizeCache", () => {
  it("measures once, then serves the cache; resize entries update it", () => {
    const { RO, state } = fakeRo();
    const c = new PaneSizeCache(RO);
    const e = el(1600, 400);
    for (let i = 0; i < 100; i++) expect(c.aspect(e.o)).toBe(4);
    expect(e.reads()).toBe(2);
    expect(state.observed).toEqual([e.o]);
    state.cb!([{ target: e.o, contentRect: { width: 5120, height: 1440 } }]);
    expect(c.pixels(e.o)).toBe(5120 * 1440);
    expect(e.reads()).toBe(2);
  });

  it("no area is undefined; forget stops observing", () => {
    const { RO, state } = fakeRo();
    const c = new PaneSizeCache(RO);
    const z = el(0, 300);
    expect(c.aspect(z.o)).toBeUndefined();
    c.forget(z.o);
    expect(state.observed).toEqual([]);
  });

  it("without ResizeObserver it reads the element each time", () => {
    const c = new PaneSizeCache(null);
    const e = el(200, 100);
    c.aspect(e.o); c.aspect(e.o);
    expect(e.reads()).toBe(4);
  });
});
