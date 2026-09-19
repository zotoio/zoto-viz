import { describe, expect, it } from "vitest";
import { bitePhrases, biteWords, facingOf, launchCrumbs, mouthCameraTheta, stepCrumb, tickerApproach } from "./pacman-ticker";

describe("pacman-ticker", () => {
  it("splits ticker lines into chewable words", () => {
    expect(biteWords(["NASA · Superbubble in the Large Magellanic Cloud"])).toContain("Superbubble");
    expect(biteWords(["a x", "hello-world"])).toEqual(["hello-world"]);
    expect(biteWords(["one two three four"], 2)).toHaveLength(2);
  });

  it("packs ticker lines into short readable phrases", () => {
    const cards = bitePhrases(["NASA · Superbubble in the Large Magellanic Cloud"]);
    expect(cards.some((c) => /Superbubble/i.test(c))).toBe(true);
    expect(cards.every((c) => c.length <= 18)).toBe(true);
    expect(mouthCameraTheta(0)).toBeCloseTo(0);
    expect(mouthCameraTheta(1)).toBeCloseTo(Math.PI / 2);
  });

  it("slides a bite into the mouth and hops crumbs down", () => {
    const mid = tickerApproach([8, 1, 0], [0, 1, 0], 0.5);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(8);
    expect(mid[1]).toBeGreaterThan(1);
    const end = tickerApproach([8, 1, 0], [0, 1, 0], 1);
    expect(end).toEqual([0, 1, 0]);
    expect(facingOf(0)).toEqual([1, 0]);
    const crumbs = launchCrumbs([0, 1, 0], 6, 3);
    expect(crumbs).toHaveLength(6);
    let c = crumbs[0]!;
    let sawUp = c.vy;
    c = stepCrumb(c, 0.016)!;
    expect(c.y).toBeGreaterThan(1);
    expect(c.vy).toBeLessThan(sawUp);
    let hops = 0;
    for (let i = 0; i < 120 && c; i++) {
      const n = stepCrumb(c, 0.04, 0);
      if (!n) break;
      if (n.y < c.y && n.vy < 0) hops++;
      c = n;
    }
    expect(hops).toBeGreaterThan(2);
  });
});
