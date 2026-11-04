/**
 * The host loop survives a throwing view: other views keep drawing, the bad view is disabled after
 * its error budget, the fps cap gates frames, and idle-skip skips views that opted in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost, type HostedView } from "./render-host";

let rafs: FrameRequestCallback[] = [];
beforeEach(() => {
  rafs = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafs.push(cb); return rafs.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function step(ts: number): void {
  const q = rafs; rafs = [];
  for (const cb of q) cb(ts);
}

function view(name: string, frame: () => void, needsFrame?: () => boolean): HostedView {
  const el = document.createElement("div");
  return { viewEl: el, tileId: name, hostFrame: frame, hostContextLost() {}, hostContextRestored() {}, ...(needsFrame ? { needsFrame } : {}) };
}

function host(): RenderHost {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
  return new RenderHost(wall, { software: true });
}

describe("render host frame guard", () => {
  it("disables a view that keeps throwing and keeps drawing the others", () => {
    const h = host();
    let good = 0; let badCalls = 0;
    h.add(view("bad", () => { badCalls++; throw new TypeError("Cannot read properties of undefined"); }));
    h.add(view("good", () => { good++; }));
    for (let i = 1; i <= 50; i++) step(i * 16.7);
    expect(good).toBe(50);
    expect(badCalls).toBe(Reflect.get(h.viewErrors, "budget"));
    expect(h.viewErrors.disabledCount).toBe(1);
    h.dispose?.();
  });

  it("fps cap draws about half the frames at 30 fps on a 60 Hz loop", () => {
    const h = host();
    let n = 0;
    h.add(view("v", () => { n++; }));
    h.setFpsCap(30);
    for (let i = 1; i <= 60; i++) step(i * 16.667);
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
    h.dispose?.();
  });

  it("idle skip: views that report nothing new are not drawn once the wall is clean", () => {
    const h = host();
    let n = 0; let busy = true;
    h.add(view("v", () => { n++; }, () => busy));
    for (let i = 1; i <= 5; i++) step(i * 16.7);
    const drawn = n;
    busy = false;
    for (let i = 6; i <= 20; i++) step(i * 16.7);
    expect(n - drawn).toBeLessThanOrEqual(1); // at most the frame that cleared `dirty`
    busy = true;
    step(21 * 16.7);
    expect(n).toBeGreaterThan(drawn);
    h.dispose?.();
  });
});
