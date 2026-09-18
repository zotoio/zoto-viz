import { describe, expect, it } from "vitest";
import {
  edgeHighlightBright,
  fabricActive,
  fabricCapacity,
  graphFaces,
  nodeHighlightBoost,
  parseFabric,
  resolveFabric,
} from "./fabric";

describe("parseFabric / resolveFabric", () => {
  it("accepts boolean and named kinds", () => {
    expect(parseFabric(true)).toBe("tubes");
    expect(parseFabric(false)).toBe("off");
    expect(parseFabric("cloth")).toBe("cloth");
    expect(parseFabric("ribbon")).toBe("ribbon");
    expect(parseFabric("nope")).toBeUndefined();
  });

  it("lets plugin style win over the settings pin", () => {
    expect(resolveFabric("cloth", "tubes")).toBe("cloth");
    expect(resolveFabric(undefined, "ribbon")).toBe("ribbon");
    expect(resolveFabric(false, true)).toBe("tubes");
    expect(resolveFabric(undefined, "off")).toBe("off");
    expect(fabricActive(resolveFabric("tubes", "off"))).toBe(true);
    expect(fabricActive("off")).toBe(false);
  });
});

describe("highlight helpers", () => {
  it("matches the sphere glow boosts", () => {
    expect(nodeHighlightBoost(true, false, false)).toBe(1.1);
    expect(nodeHighlightBoost(false, true, true)).toBe(0.7);
    expect(nodeHighlightBoost(false, false, true)).toBe(0.45);
    expect(nodeHighlightBoost(false, false, false)).toBe(0.12);
  });

  it("dims non-incident edges when a node is selected", () => {
    expect(edgeHighlightBright(0.4, true, true, true)).toBe(0.9);
    expect(edgeHighlightBright(0.4, false, true, true)).toBeCloseTo(0.14);
    expect(edgeHighlightBright(0.4, false, false, true)).toBe(0.4);
    expect(edgeHighlightBright(0.9, false, false, false)).toBe(0);
  });
});

describe("graphFaces", () => {
  it("finds undirected 3-cycles once", () => {
    const faces = graphFaces([
      ["a", "b"], ["b", "c"], ["c", "a"],
      ["a", "d"],
    ]);
    expect(faces).toEqual([["a", "b", "c"]]);
  });

  it("caps and ignores self-loops", () => {
    expect(graphFaces([["a", "a"], ["a", "b"]], 1)).toEqual([]);
    const many: [string, string][] = [];
    for (let i = 0; i < 6; i++) {
      many.push([`n${i}`, `n${(i + 1) % 6}`]);
      many.push([`n${i}`, `n${(i + 2) % 6}`]);
    }
    expect(graphFaces(many, 3)).toHaveLength(3);
  });
});

describe("fabricCapacity", () => {
  it("counts ribbon discs cheaper than tube hubs", () => {
    const tubes = fabricCapacity("tubes", 4, 3, 1);
    const cloth = fabricCapacity("cloth", 4, 3, 1);
    const ribbon = fabricCapacity("ribbon", 4, 3, 1);
    expect(cloth.verts).toBeGreaterThan(tubes.verts);
    expect(ribbon.verts).toBeLessThan(tubes.verts);
    expect(tubes.indices).toBeGreaterThan(0);
  });
});
