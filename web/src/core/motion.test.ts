import { describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, subscribeReducedMotion } from "./motion";

describe("prefersReducedMotion", () => {
  it("notifies subscribers when the media query changes", () => {
    const listeners: Array<(e: Event) => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: (e: Event) => void) => { listeners.push(cb); },
      removeEventListener: (_: string, cb: (e: Event) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    vi.stubGlobal("matchMedia", () => mq);
    const seen: boolean[] = [];
    const off = subscribeReducedMotion(() => seen.push(prefersReducedMotion()));
    expect(seen).toEqual([]);
    mq.matches = true;
    listeners.forEach((cb) => cb(new Event("change")));
    expect(seen).toEqual([true]);
    off();
    vi.unstubAllGlobals();
  });
});
