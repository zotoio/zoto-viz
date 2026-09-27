import { describe, expect, it, vi } from "vitest";
import {
  advanceCubeFaces,
  cubeDrift,
  FeedTitleCube,
  seedCubeFaces,
  uniqueFeedTitles,
} from "./feed-title-cube";

describe("feed title cube", () => {
  it("keeps the first unique titles", () => {
    expect(uniqueFeedTitles(["  Mastodon  ", "Mastodon", "", "Lobsters", "Guardian"])).toEqual([
      "Mastodon",
      "Lobsters",
      "Guardian",
    ]);
  });

  it("collapses a wrapped title onto one cube face line", () => {
    expect(uniqueFeedTitles(["A\nlong\nNASA title", "A long NASA title", "Next"])).toEqual([
      "A long NASA title",
      "Next",
    ]);
  });

  it("drifts across the screen and stays inside it", () => {
    const box = { w: 1600, h: 900, top: 76, cube: 280 };
    const a = cubeDrift(0, box);
    const b = cubeDrift(20, box);
    expect(a).not.toEqual(b);
    const later = cubeDrift(10, box);
    expect(Math.hypot(later.x - a.x, later.y - a.y)).toBeLessThan(100);
    for (const p of [a, b, cubeDrift(40, box), cubeDrift(90, box)]) {
      expect(p.x).toBeGreaterThanOrEqual(12);
      expect(p.y).toBeGreaterThanOrEqual(box.top + 12);
      expect(p.x + box.cube).toBeLessThanOrEqual(box.w - 12);
      expect(p.y + box.cube).toBeLessThanOrEqual(box.h - 12);
    }
  });

  it("fills six faces and rotates in the next title", () => {
    const titles = ["a", "b", "c", "d", "e", "f", "g"];
    expect(seedCubeFaces(titles)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(advanceCubeFaces(seedCubeFaces(titles), titles)).toEqual(["b", "c", "d", "e", "f", "g"]);
  });

  it("repeats a short list so every face has a title", () => {
    expect(seedCubeFaces(["Only"])).toEqual(["Only", "Only", "Only", "Only", "Only", "Only"]);
  });

  it("remounts after the wall is cleared and does not fetch with no titles", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    document.body.append(host);
    const cube = new FeedTitleCube(host);
    host.replaceChildren();
    cube.setActive(true);
    expect(host.contains(cube.el)).toBe(true);
    cube.sync([]);
    expect(cube.el.hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    cube.dispose();
    host.remove();
    vi.unstubAllGlobals();
  });
});
