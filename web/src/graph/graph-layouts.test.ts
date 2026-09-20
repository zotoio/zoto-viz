import { describe, expect, it } from "vitest";
import {
  graphLayoutAnimates,
  graphLayoutIsFlat,
  graphLayoutPlaces,
  graphLinksArrows,
  graphLinksBundle,
  layoutGraph,
  parseGraphLayout,
  parseGraphLinks,
  pickHub,
  spanningParents,
  type LayoutLink,
  type LayoutNode,
} from "./graph-layouts";

const nodes = (...roles: [string, string][]): LayoutNode[] =>
  roles.map(([id, role], i) => ({ id, role, rate: (i + 1) * 100, bytesIn: i * 10, bytesOut: i * 3 }));

const links = (...pairs: [string, string][]): LayoutLink[] =>
  pairs.map(([a, b]) => ({ a, b }));

const star = () => ({
  nodes: nodes(["gw", "gateway"], ["self", "self"], ["a", "lan"], ["b", "lan"], ["c", "internet"]),
  links: links(["gw", "self"], ["gw", "a"], ["gw", "b"], ["a", "c"]),
});

describe("parseGraphLayout / parseGraphLinks", () => {
  it("accepts known kinds", () => {
    expect(parseGraphLayout("tree")).toBe("tree");
    expect(parseGraphLayout("globe")).toBe("globe");
    expect(parseGraphLayout("nope")).toBeUndefined();
    expect(parseGraphLinks("both")).toBe("both");
    expect(parseGraphLinks("wires")).toBeUndefined();
    expect(graphLayoutPlaces("tree")).toBe(true);
    expect(graphLayoutPlaces("force")).toBe(false);
    expect(graphLayoutPlaces("auto")).toBe(false);
    expect(graphLayoutIsFlat("tree")).toBe(true);
    expect(graphLayoutIsFlat("globe")).toBe(false);
    expect(graphLayoutIsFlat("ripple")).toBe(true);
    expect(graphLayoutIsFlat("helix")).toBe(false);
    expect(graphLayoutAnimates("helix")).toBe(true);
    expect(graphLayoutAnimates("tree")).toBe(false);
    expect(parseGraphLayout("vortex")).toBe("vortex");
    expect(parseGraphLayout("mobius")).toBe("mobius");
    expect(parseGraphLayout("hilbert")).toBe("hilbert");
    expect(parseGraphLayout("spectrum")).toBe("spectrum");
    expect(parseGraphLayout("heap")).toBe("heap");
    expect(graphLayoutIsFlat("hilbert")).toBe(true);
    expect(graphLayoutIsFlat("spectrum")).toBe(false);
    expect(graphLayoutAnimates("spectrum")).toBe(true);
    expect(graphLayoutAnimates("heap")).toBe(false);
    expect(graphLinksArrows("arrows")).toBe(true);
    expect(graphLinksArrows("both")).toBe(true);
    expect(graphLinksBundle("bundle")).toBe(true);
    expect(graphLinksBundle("auto")).toBe(false);
  });
});

describe("pickHub / spanningParents", () => {
  it("prefers gateway then self", () => {
    const n = nodes(["a", "lan"], ["me", "self"], ["gw", "gateway"]);
    expect(pickHub(n)).toBe("gw");
    expect(pickHub(n, "me")).toBe("me");
  });

  it("builds a BFS tree and hangs orphans off the hub", () => {
    const { nodes: ns, links: ls } = star();
    const p = spanningParents(ns.map((n) => n.id), ls, "gw");
    expect(p.get("gw")).toBeNull();
    expect(p.get("a")).toBe("gw");
    expect(p.get("c")).toBe("a");
    expect(p.get("self")).toBe("gw");
  });
});

describe("layoutGraph", () => {
  it("places a tree with depth along Z", () => {
    const { nodes: ns, links: ls } = star();
    const t = layoutGraph("tree", ns, ls, { flatten: true });
    expect(t.get("gw")![2]).toBeCloseTo(0, 5);
    expect(t.get("a")![2]).toBeGreaterThan(t.get("gw")![2]!);
    expect(t.get("c")![2]).toBeGreaterThan(t.get("a")![2]!);
  });

  it("radial keeps the hub at the origin", () => {
    const { nodes: ns, links: ls } = star();
    const t = layoutGraph("radial", ns, ls, { flatten: true });
    expect(t.get("gw")).toEqual([0, 0, 0]);
    const r = (id: string) => Math.hypot(t.get(id)![0], t.get(id)![2]);
    expect(r("c")).toBeGreaterThan(r("a"));
  });

  it("concentric / cluster / globe / dag cover every id", () => {
    const { nodes: ns, links: ls } = star();
    for (const kind of ["concentric", "cluster", "globe", "dag", "bars", "scatter"] as const) {
      const t = layoutGraph(kind, ns, ls);
      expect(t.size).toBe(ns.length);
      for (const n of ns) expect(t.get(n.id)).toHaveLength(3);
    }
  });

  it("bars raise busier nodes", () => {
    const ns = nodes(["a", "lan"], ["b", "lan"]);
    ns[0]!.rate = 10;
    ns[1]!.rate = 1000;
    const t = layoutGraph("bars", ns, []);
    expect(t.get("b")![1]).toBeGreaterThan(t.get("a")![1]!);
  });

  it("invented structures cover every id and move with time", () => {
    const { nodes: ns, links: ls } = star();
    const kinds = [
      "helix", "vortex", "bloom", "ripple", "weave", "cascade", "knot",
      "hourglass", "coral", "tide", "mobius", "spine", "halo", "fold", "drift",
    ] as const;
    for (const kind of kinds) {
      const t = layoutGraph(kind, ns, ls, { time: 0, pulse: 0.4 });
      expect(t.size).toBe(ns.length);
      for (const n of ns) expect(t.get(n.id)).toHaveLength(3);
    }
    const a = layoutGraph("helix", ns, ls, { time: 0 });
    const b = layoutGraph("helix", ns, ls, { time: 1.2 });
    expect(a.get("a")![0]).not.toBeCloseTo(b.get("a")![0]!, 3);
    const tideA = layoutGraph("tide", ns, ls, { flatten: false, time: 0 });
    const tideB = layoutGraph("tide", ns, ls, { flatten: false, time: 2 });
    expect(tideA.get("a")![1]).not.toBeCloseTo(tideB.get("a")![1]!, 3);
  });

  it("helix is volumetric even when flatten is asked for height", () => {
    const { nodes: ns, links: ls } = star();
    const t = layoutGraph("helix", ns, ls, { flatten: false, time: 0 });
    const ys = [...t.values()].map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });

  it("force and auto return no targets", () => {
    const { nodes: ns, links: ls } = star();
    expect(layoutGraph("auto", ns, ls).size).toBe(0);
    expect(layoutGraph("force", ns, ls).size).toBe(0);
  });

  it("fractal fft and data-structure layouts cover every id", () => {
    const { nodes: ns, links: ls } = star();
    const kinds = [
      "sierpinski", "hilbert", "koch", "julia",
      "spectrum", "waterfall", "carrier", "phased",
      "heap", "trie", "hashmap", "matrix", "queue",
    ] as const;
    for (const kind of kinds) {
      const t = layoutGraph(kind, ns, ls, { time: 0.4, pulse: 0.5, bins: [0.1, 0.8, 0.2, 0.4] });
      expect(t.size).toBe(ns.length);
      for (const n of ns) expect(t.get(n.id)).toHaveLength(3);
    }
  });

  it("heap puts the busiest talker at the root", () => {
    const ns = nodes(["quiet", "lan"], ["busy", "lan"], ["mid", "lan"]);
    ns[0]!.rate = 2;
    ns[1]!.rate = 900;
    ns[2]!.rate = 40;
    const t = layoutGraph("heap", ns, [], { flatten: false });
    expect(t.get("busy")![2]).toBeLessThan(t.get("quiet")![2]!);
    expect(t.get("busy")![1]).toBeGreaterThan(t.get("quiet")![1]!);
  });

  it("trie keeps same-/24 hosts closer than distant prefixes", () => {
    const ns: LayoutNode[] = [
      { id: "a", role: "lan", ip: "10.0.1.2", rate: 1 },
      { id: "b", role: "lan", ip: "10.0.1.9", rate: 1 },
      { id: "c", role: "internet", ip: "8.8.8.8", rate: 1 },
    ];
    const t = layoutGraph("trie", ns, []);
    const dx = (p: string, q: string) => Math.abs(t.get(p)![0] - t.get(q)![0]);
    expect(dx("a", "b")).toBeLessThan(dx("a", "c"));
  });

  it("queue lines up newest last-seen at the head", () => {
    const ns: LayoutNode[] = [
      { id: "old", role: "lan", lastSeen: 10, rate: 1 },
      { id: "new", role: "lan", lastSeen: 99, rate: 1 },
      { id: "mid", role: "lan", lastSeen: 40, rate: 1 },
    ];
    const t = layoutGraph("queue", ns, []);
    expect(t.get("new")![0]).toBeLessThan(t.get("mid")![0]!);
    expect(t.get("mid")![0]).toBeLessThan(t.get("old")![0]!);
  });

  it("matrix raises high-rate hubs and parks leaves far in hop", () => {
    const ns = nodes(["gw", "gateway"], ["leaf", "lan"], ["hub", "lan"]);
    ns[1]!.rate = 1;
    ns[2]!.rate = 800;
    const ls = links(["gw", "hub"], ["hub", "leaf"]);
    const t = layoutGraph("matrix", ns, ls, { flatten: false, hub: "gw" });
    expect(t.get("hub")![1]).toBeGreaterThan(t.get("leaf")![1]!);
    expect(t.get("leaf")![2]).toBeGreaterThan(t.get("gw")![2]!);
  });

  it("spectrum height follows FFT bins when the mic is on", () => {
    const ns = nodes(["a", "lan"], ["b", "lan"], ["c", "lan"]);
    ns[0]!.rate = 300;
    ns[1]!.rate = 200;
    ns[2]!.rate = 100;
    const t = layoutGraph("spectrum", ns, [], { flatten: false, bins: [0.1, 0.95, 0.2] });
    expect(t.get("b")![1]).toBeGreaterThan(t.get("a")![1]!);
  });

  it("hilbert keeps neighbouring ranks spatially close", () => {
    const ns = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`, role: "lan", rate: 800 - i * 80,
    }));
    const t = layoutGraph("hilbert", ns, []);
    const dist = (a: string, b: string) => {
      const p = t.get(a)!, q = t.get(b)!;
      return Math.hypot(p[0] - q[0], p[2] - q[2]);
    };
    expect(dist("n0", "n1")).toBeLessThan(dist("n0", "n7"));
  });

  it("globe is volumetric even when flatten is asked", () => {
    const { nodes: ns, links: ls } = star();
    const t = layoutGraph("globe", ns, ls, { flatten: true });
    const ys = [...t.values()].map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });
});
