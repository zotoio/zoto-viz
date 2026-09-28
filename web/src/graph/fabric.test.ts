import { describe, expect, it } from "vitest";
import {
  edgeHighlightBright,
  fabricActive,
  fabricCapacity,
  graphFaces,
  GraphFabric,
  nodeHighlightBoost,
  parseFabric,
  resolveFabric,
  resolveGraphFlatten,
  type FabricEdgePose,
  type FabricKind,
  type FabricNodePose,
} from "./fabric";

describe("parseFabric / resolveFabric", () => {
  it("accepts boolean and named kinds", () => {
    expect(parseFabric(true)).toBe("tubes");
    expect(parseFabric(false)).toBe("off");
    expect(parseFabric("cloth")).toBe("cloth");
    expect(parseFabric("ribbon")).toBe("ribbon");
    expect(parseFabric("octopus")).toBe("octopus");
    expect(parseFabric("nope")).toBeUndefined();
  });

  it("lets settings named style win over the plugin pin", () => {
    expect(resolveFabric("cloth", "tubes")).toBe("tubes");
    expect(resolveFabric(undefined, "ribbon")).toBe("ribbon");
    expect(resolveFabric(false, true)).toBe("tubes");
    expect(resolveFabric(undefined, "off")).toBe("off");
    expect(fabricActive(resolveFabric("tubes", "off"))).toBe(false);
    expect(fabricActive("off")).toBe(false);
  });

  it("lets space override a pinned layout's flatten", () => {
    expect(resolveGraphFlatten(true, "auto")).toBe(true);
    expect(resolveGraphFlatten(true, "space")).toBe(false);
    expect(resolveGraphFlatten(false, "plane")).toBe(true);
    expect(resolveGraphFlatten(true, "auto", "globe")).toBe(false);
    expect(resolveGraphFlatten(false, "auto", "tree")).toBe(true);
    expect(resolveGraphFlatten(true, "space", "tree")).toBe(false);
    expect(resolveGraphFlatten(true, "auto", "force")).toBe(false);
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

function pose(id: string, x: number, z: number): FabricNodePose {
  return { id, x, y: 0, z, scale: 4, r: 0.9, g: 0.35, b: 0.15, glow: 0.3, opacity: 1, visible: true };
}

const edge = (a: string, b: string): FabricEdgePose => ({
  a, b, r0: 0.8, g0: 0.3, b0: 0.1, r1: 0.2, g1: 0.5, b1: 0.8, gab: 0, gba: 0, wave: 0, visible: true,
});

const syncOpts = { time: 1, pulse: 0, glowMode: "off" as const, glowAmt: 0, glowSpeed: 1, additive: false };

describe("sculpted fabrics", () => {
  const kinds: FabricKind[] = ["octopus", "jelly", "hole", "tornado", "burst"];

  it("fills exactly the capacity it reserves", () => {
    for (const kind of kinds) {
      const fabric = new GraphFabric();
      fabric.setKind(kind);
      fabric.sync([pose("a", 0, 0), pose("b", 36, 0)], [edge("a", "b")], [], syncOpts);
      const cpu = fabric.meshCpu();
      const cap = fabricCapacity(kind, 2, 1, 0);
      expect(cpu, kind).not.toBeNull();
      expect(cpu!.verts, kind).toBe(cap.verts);
      expect(cpu!.indices, kind).toBe(cap.indices);
    }
  });

  it("gives each kind a different silhouette", () => {
    const mesh = (kind: FabricKind, nodes: FabricNodePose[], edges: FabricEdgePose[] = []) => {
      const fabric = new GraphFabric();
      fabric.setKind(kind);
      fabric.sync(nodes, edges, [], syncOpts);
      return fabric.meshCpu()!;
    };
    const octo = mesh("octopus", [pose("a", 0, 0)]);
    let wide = 0, low = 0;
    for (let i = 0; i < octo.verts; i++) {
      wide = Math.max(wide, Math.abs(octo.pos[i * 3] ?? 0));
      low = Math.min(low, octo.pos[i * 3 + 1] ?? 0);
    }
    expect(wide).toBeGreaterThan(4);
    expect(low).toBeLessThan(-2);

    const blast = mesh("burst", [pose("a", 0, 0)]);
    let reach = 0;
    for (let i = 0; i < blast.verts; i++) {
      reach = Math.max(reach, Math.hypot(blast.pos[i * 3] ?? 0, blast.pos[i * 3 + 1] ?? 0, blast.pos[i * 3 + 2] ?? 0));
    }
    expect(reach).toBeGreaterThan(6);

    const hole = mesh("hole", [pose("a", 0, 0)]);
    let dark = false, disc = false;
    for (let i = 0; i < hole.verts; i++) {
      const x = hole.pos[i * 3] ?? 0, z = hole.pos[i * 3 + 2] ?? 0;
      if ((hole.col[i * 3] ?? 1) < 0.2 && Math.hypot(x, z) < 2) dark = true;
      if (Math.hypot(x, z) > 6) disc = true;
    }
    expect(dark).toBe(true);
    expect(disc).toBe(true);

    const spin = mesh("tornado", [pose("a", 0, 0), pose("b", 40, 0)], [edge("a", "b")]);
    let off = 0;
    for (let i = 0; i < spin.verts; i++) off = Math.max(off, Math.hypot(spin.pos[i * 3 + 1] ?? 0, spin.pos[i * 3 + 2] ?? 0));
    expect(off).toBeGreaterThan(3);
  });
});
