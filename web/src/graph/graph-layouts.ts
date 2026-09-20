/**
 * Host graph placements. Library-shaped ones (tree / radial / globe / bars)
 * plus first-party model+animation structures and insight placements
 * (fractals, radio/FFT, data structures). Pure: ids in, xyz out. The scene
 * force pulls toward these targets so the worker stays generic. Animated
 * kinds take `opts.time` / `opts.pulse`; FFT kinds take `opts.bins` / `opts.frames`.
 */

export const GRAPH_LAYOUTS = [
  "auto", "force", "tree", "radial", "concentric", "cluster", "dag", "globe", "bars", "scatter",
  "helix", "vortex", "bloom", "ripple", "weave", "cascade", "knot", "hourglass", "coral",
  "tide", "mobius", "spine", "halo", "fold", "drift",
  "sierpinski", "hilbert", "koch", "julia",
  "spectrum", "waterfall", "carrier", "phased",
  "heap", "trie", "hashmap", "matrix", "queue",
] as const;
export type GraphLayout = (typeof GRAPH_LAYOUTS)[number];

export const GRAPH_LAYOUT_OPTIONS: { value: GraphLayout; label: string; hint: string }[] = [
  { value: "auto", label: "auto", hint: "keep the view's own layout (LAN rings, SYS charts, plugin force)" },
  { value: "force", label: "force", hint: "drop the view's extra force so d3-force-3d + physics own the cloud" },
  { value: "tree", label: "tree", hint: "hierarchical spanning tree from the gateway / self hub" },
  { value: "radial", label: "radial", hint: "depth as radius, siblings around the hub" },
  { value: "concentric", label: "rings", hint: "one ring per role, gateway in the middle" },
  { value: "cluster", label: "cluster", hint: "role communities parked on a ring of islands" },
  { value: "dag", label: "layers", hint: "BFS layers from the hub (force-directed DAG)" },
  { value: "globe", label: "globe", hint: "nested spherical shells by role" },
  { value: "bars", label: "bars", hint: "3D bar chart — height is live byte-rate" },
  { value: "scatter", label: "scatter", hint: "3D scatter — rate / bytes / role axes" },
  { value: "helix", label: "helix", hint: "double helix — LAN and internet wind opposite strands (turns with time)" },
  { value: "vortex", label: "vortex", hint: "tornado — busy nodes climb, radius shrinks, the column spins" },
  { value: "bloom", label: "bloom", hint: "flower — hub as pistil, role petals that breathe open on pulse" },
  { value: "ripple", label: "ripple", hint: "hop rings from the hub that expand and contract like water" },
  { value: "weave", label: "weave", hint: "loom — roles as warp, talkers as weft, cloth undulates" },
  { value: "cascade", label: "cascade", hint: "waterfall — role lanes, traffic falls and wraps" },
  { value: "knot", label: "knot", hint: "torus knot — every node slides along a (3,2) loop" },
  { value: "hourglass", label: "glass", hint: "two cones — inbound above the pinch, outbound below" },
  { value: "coral", label: "coral", hint: "living branch — spanning tree grows and twists from the hub" },
  { value: "tide", label: "tide", hint: "sea surface — role grid riding two crossing swells" },
  { value: "mobius", label: "twist", hint: "Möbius strip — one-sided walk that flips as it turns" },
  { value: "spine", label: "spine", hint: "vertebral column — hops as discs, siblings as ribs" },
  { value: "halo", label: "halo", hint: "nested role rings stacked in height, each spinning at its own rate" },
  { value: "fold", label: "fold", hint: "accordion crease — nodes ride a zigzag paper fold" },
  { value: "drift", label: "drift", hint: "laminar river — role streams flowing along Z" },
  { value: "sierpinski", label: "sierp", hint: "Sierpinski gasket — hop depth is IFS iteration; same-prefix talkers share a vertex" },
  { value: "hilbert", label: "hilbert", hint: "Hilbert curve — rate-ranked talkers stay spatially close (locality)" },
  { value: "koch", label: "koch", hint: "Koch flake — spanning-tree walk along a fractal coastline" },
  { value: "julia", label: "julia", hint: "Julia set — id is the seed, escape time is height (outliers pop)" },
  { value: "spectrum", label: "fft", hint: "FFT spectrum — X is frequency bin, height is power (mic or DFT of rates)" },
  { value: "waterfall", label: "fall", hint: "radio waterfall — frequency × time, power as height" },
  { value: "carrier", label: "carrier", hint: "AM carrier — nodes ride a sine; envelope is live rate" },
  { value: "phased", label: "array", hint: "phased array — line of elements, phase from FFT bin / channel" },
  { value: "heap", label: "heap", hint: "binary max-heap — busiest talker at the root (priority queue of rate)" },
  { value: "trie", label: "trie", hint: "IPv4 prefix trie — octets as digits, subnets as shared paths" },
  { value: "hashmap", label: "hash", hint: "hash table — id buckets; tall stacks are collisions" },
  { value: "matrix", label: "matrix", hint: "feature matrix — degree × hop, height is rate (who is a hub vs a leaf)" },
  { value: "queue", label: "queue", hint: "FIFO by last-seen — newest arrivals at the head" },
];

export const GRAPH_LAYOUT_DICE: GraphLayout[] = GRAPH_LAYOUTS.filter((k) => k !== "auto");

export const GRAPH_LINKS = ["auto", "arrows", "bundle", "both"] as const;
export type GraphLinks = (typeof GRAPH_LINKS)[number];

export const GRAPH_LINK_OPTIONS: { value: GraphLinks; label: string; hint: string }[] = [
  { value: "auto", label: "auto", hint: "straight or sagging strings; traffic sparks still run" },
  { value: "arrows", label: "arrows", hint: "cones on each edge in the traffic direction" },
  { value: "bundle", label: "bundle", hint: "hierarchical edge bundling toward the hub" },
  { value: "both", label: "both", hint: "bundled curves plus directional arrows" },
];

export const GRAPH_LINK_DICE: GraphLinks[] = GRAPH_LINKS.filter((k) => k !== "auto");

/** Layouts that sit on a plane unless Settings → space is 3D. */
const FLAT_LAYOUTS = new Set<GraphLayout>([
  "tree", "radial", "concentric", "cluster", "dag",
  "ripple", "weave", "fold", "drift",
  "sierpinski", "hilbert", "koch", "heap", "trie", "hashmap", "matrix", "queue",
]);

/** Targets move every frame (need quantized time in the scene cache key). */
const ANIMATED_LAYOUTS = new Set<GraphLayout>([
  "helix", "vortex", "bloom", "ripple", "weave", "cascade", "knot",
  "hourglass", "coral", "tide", "mobius", "spine", "halo", "fold", "drift",
  "sierpinski", "koch", "julia", "spectrum", "waterfall", "carrier", "phased", "queue",
]);

export function graphLayoutAnimates(kind: GraphLayout | undefined | null): boolean {
  return !!kind && ANIMATED_LAYOUTS.has(kind);
}

export function parseGraphLayout(raw: unknown): GraphLayout | undefined {
  if (typeof raw === "string" && (GRAPH_LAYOUTS as readonly string[]).includes(raw)) {
    return raw as GraphLayout;
  }
  return undefined;
}

export function parseGraphLinks(raw: unknown): GraphLinks | undefined {
  if (typeof raw === "string" && (GRAPH_LINKS as readonly string[]).includes(raw)) {
    return raw as GraphLinks;
  }
  return undefined;
}

export function graphLayoutPinned(kind: GraphLayout | undefined | null): boolean {
  return !!kind && kind !== "auto";
}

export function graphLayoutIsForce(kind: GraphLayout | undefined | null): boolean {
  return kind === "force";
}

export function graphLayoutPlaces(kind: GraphLayout | undefined | null): boolean {
  return graphLayoutPinned(kind) && kind !== "force";
}

export function graphLayoutIsFlat(kind: GraphLayout): boolean {
  return FLAT_LAYOUTS.has(kind);
}

export function graphLinksArrows(kind: GraphLinks | undefined | null): boolean {
  return kind === "arrows" || kind === "both";
}

export function graphLinksBundle(kind: GraphLinks | undefined | null): boolean {
  return kind === "bundle" || kind === "both";
}

export type LayoutXyz = [number, number, number];

export type LayoutNode = {
  id: string;
  role: string;
  rate?: number;
  bytesIn?: number;
  bytesOut?: number;
  ip?: string;
  chan?: number;
  lastSeen?: number;
  degree?: number;
};

export type LayoutLink = { a: string; b: string };

export type LayoutGraphOpts = {
  spreadX?: number;
  flatten?: boolean;
  hub?: string;
  /** seconds, for animated structures */
  time?: number;
  /** 0–1 live pulse, opens bloom / lifts tide */
  pulse?: number;
  /** mic FFT magnitudes 0–1; layouts DFT rates when empty */
  bins?: readonly number[];
  /** recent spectrum frames for the radio waterfall */
  frames?: readonly number[][];
};

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const ROLE_RING = ["gateway", "self", "local", "lan", "multicast", "internet", "other"] as const;

export function pickHub(nodes: readonly LayoutNode[], prefer?: string): string {
  if (prefer && nodes.some((n) => n.id === prefer)) return prefer;
  const byRole = (role: string) => nodes.find((n) => n.role === role)?.id;
  return byRole("gateway") ?? byRole("self") ?? nodes[0]?.id ?? "";
}

export function layoutGraph(
  kind: GraphLayout,
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  opts: LayoutGraphOpts = {},
): Map<string, LayoutXyz> {
  const spreadX = opts.spreadX ?? 1;
  const flatten = opts.flatten !== false;
  const hub = pickHub(nodes, opts.hub);
  const time = opts.time ?? 0;
  const pulse = opts.pulse ?? 0;
  switch (kind) {
    case "tree": return treeLayout(nodes, links, hub, spreadX, flatten);
    case "radial": return radialLayout(nodes, links, hub, spreadX, flatten);
    case "concentric": return concentricLayout(nodes, spreadX, flatten);
    case "cluster": return clusterLayout(nodes, spreadX, flatten);
    case "dag": return dagLayout(nodes, links, hub, spreadX, flatten);
    case "globe": return globeLayout(nodes, spreadX);
    case "bars": return barsLayout(nodes, spreadX);
    case "scatter": return scatterLayout(nodes, spreadX);
    case "helix": return helixLayout(nodes, spreadX, flatten, time);
    case "vortex": return vortexLayout(nodes, spreadX, flatten, time);
    case "bloom": return bloomLayout(nodes, links, hub, spreadX, flatten, time, pulse);
    case "ripple": return rippleLayout(nodes, links, hub, spreadX, flatten, time);
    case "weave": return weaveLayout(nodes, spreadX, flatten, time);
    case "cascade": return cascadeLayout(nodes, spreadX, flatten, time);
    case "knot": return knotLayout(nodes, spreadX, flatten, time);
    case "hourglass": return hourglassLayout(nodes, spreadX, flatten, time);
    case "coral": return coralLayout(nodes, links, hub, spreadX, flatten, time);
    case "tide": return tideLayout(nodes, spreadX, flatten, time, pulse);
    case "mobius": return mobiusLayout(nodes, spreadX, flatten, time);
    case "spine": return spineLayout(nodes, links, hub, spreadX, flatten, time);
    case "halo": return haloLayout(nodes, spreadX, flatten, time);
    case "fold": return foldLayout(nodes, spreadX, flatten, time);
    case "drift": return driftLayout(nodes, spreadX, flatten, time);
    case "sierpinski": return sierpinskiLayout(nodes, links, hub, spreadX, flatten, pulse);
    case "hilbert": return hilbertLayout(nodes, spreadX, flatten);
    case "koch": return kochLayout(nodes, links, hub, spreadX, flatten, time);
    case "julia": return juliaLayout(nodes, spreadX, flatten, time);
    case "spectrum": return spectrumLayout(nodes, spreadX, flatten, opts.bins, pulse);
    case "waterfall": return waterfallLayout(nodes, spreadX, flatten, time, opts.bins, opts.frames);
    case "carrier": return carrierLayout(nodes, spreadX, flatten, time, pulse);
    case "phased": return phasedLayout(nodes, spreadX, flatten, time, opts.bins);
    case "heap": return heapLayout(nodes, spreadX, flatten);
    case "trie": return trieLayout(nodes, spreadX, flatten);
    case "hashmap": return hashmapLayout(nodes, spreadX, flatten);
    case "matrix": return matrixLayout(nodes, links, hub, spreadX, flatten);
    case "queue": return queueLayout(nodes, spreadX, flatten);
    default: return new Map();
  }
}

function adjList(ids: readonly string[], links: readonly LayoutLink[]): Map<string, string[]> {
  const known = new Set(ids);
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (a === b || !known.has(a) || !known.has(b)) return;
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    adj.set(a, list);
  };
  for (const l of links) {
    add(l.a, l.b);
    add(l.b, l.a);
  }
  return adj;
}

/** BFS spanning tree from hub; unreachable nodes hang off the hub. */
export function spanningParents(
  ids: readonly string[],
  links: readonly LayoutLink[],
  hub: string,
): Map<string, string | null> {
  const adj = adjList(ids, links);
  const parent = new Map<string, string | null>();
  if (!hub || !ids.includes(hub)) {
    for (const id of ids) parent.set(id, null);
    return parent;
  }
  parent.set(hub, null);
  const q = [hub];
  for (let i = 0; i < q.length; i++) {
    const u = q[i]!;
    for (const v of adj.get(u) ?? []) {
      if (parent.has(v)) continue;
      parent.set(v, u);
      q.push(v);
    }
  }
  for (const id of ids) {
    if (!parent.has(id)) parent.set(id, id === hub ? null : hub);
  }
  return parent;
}

function childrenOf(parent: Map<string, string | null>): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const [id, p] of parent) {
    if (!p) continue;
    const list = kids.get(p) ?? [];
    list.push(id);
    kids.set(p, list);
  }
  for (const list of kids.values()) list.sort();
  return kids;
}

function leafWalk(hub: string, kids: Map<string, string[]>, known: Set<string>): Map<string, number> {
  const leafX = new Map<string, number>();
  let next = 0;
  const walk = (id: string): number => {
    const child = kids.get(id) ?? [];
    if (!child.length) {
      const x = next++;
      leafX.set(id, x);
      return x;
    }
    let sum = 0;
    for (const k of child) sum += walk(k);
    const x = sum / child.length;
    leafX.set(id, x);
    return x;
  };
  if (known.has(hub)) walk(hub);
  else {
    for (const id of known) if (!leafX.has(id)) walk(id);
  }
  return leafX;
}

function depthOf(id: string, parent: Map<string, string | null>): number {
  let d = 0;
  let cur: string | null | undefined = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = parent.get(cur);
    if (!p) break;
    d++;
    cur = p;
  }
  return d;
}

function treeLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const kids = childrenOf(parent);
  const leafX = leafWalk(hub, kids, new Set(ids));
  const xs = [...leafX.values()];
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const x = ((leafX.get(n.id) ?? 0) - mid) * 56 * spreadX;
    const d = depthOf(n.id, parent);
    if (flatten) out.set(n.id, [x, 0, d * 72]);
    else out.set(n.id, [x, Math.max(0, 140 - d * 28), d * 64]);
  }
  return out;
}

function radialLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const kids = childrenOf(parent);
  const leafX = leafWalk(hub, kids, new Set(ids));
  const nLeaf = Math.max(1, new Set(leafX.values()).size);
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const d = depthOf(n.id, parent);
    const r = d === 0 ? 0 : 70 + d * 88;
    const a = ((leafX.get(n.id) ?? 0) / nLeaf) * Math.PI * 2 - Math.PI / 2;
    const y = flatten ? 0 : (d % 2 ? 36 : -18);
    out.set(n.id, [Math.cos(a) * r * spreadX, y, Math.sin(a) * r]);
  }
  return out;
}

function concentricLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const role = ROLE_RING.includes(n.role as typeof ROLE_RING[number]) ? n.role : "other";
    const list = groups.get(role) ?? [];
    list.push(n);
    groups.set(role, list);
  }
  const out = new Map<string, LayoutXyz>();
  ROLE_RING.forEach((role, ring) => {
    const list = groups.get(role);
    if (!list?.length) return;
    if (role === "gateway" && list.length === 1) {
      out.set(list[0]!.id, [0, flatten ? 0 : 8, 0]);
      return;
    }
    const R = 90 + ring * 95;
    list.forEach((n, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + ring * 0.18;
      const y = flatten ? 0 : (i % 2 ? 28 : -16);
      out.set(n.id, [Math.cos(a) * R * spreadX, y, Math.sin(a) * R]);
    });
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

function clusterLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const role = ROLE_RING.includes(n.role as typeof ROLE_RING[number]) ? n.role : "other";
    const list = groups.get(role) ?? [];
    list.push(n);
    groups.set(role, list);
  }
  const kinds = ROLE_RING.filter((r) => groups.has(r));
  const out = new Map<string, LayoutXyz>();
  kinds.forEach((kind, gi) => {
    const ring = groups.get(kind)!;
    const a0 = (gi / Math.max(1, kinds.length)) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a0) * 220 * spreadX;
    const cz = Math.sin(a0) * 220;
    const cy = flatten ? 0 : (gi % 2 ? 70 : -50);
    ring.forEach((n, i) => {
      const r = 28 + Math.min(36, Math.sqrt(i) * 14);
      const a = i * GOLDEN;
      out.set(n.id, [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]);
    });
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

function dagLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const layers = new Map<number, string[]>();
  let maxD = 0;
  for (const n of nodes) {
    const d = depthOf(n.id, parent);
    maxD = Math.max(maxD, d);
    const list = layers.get(d) ?? [];
    list.push(n.id);
    layers.set(d, list);
  }
  const out = new Map<string, LayoutXyz>();
  for (const [d, list] of layers) {
    list.sort();
    list.forEach((id, i) => {
      const x = (i - (list.length - 1) / 2) * 64 * spreadX;
      const z = (d - maxD * 0.35) * 90;
      const y = flatten ? 0 : (d * 18 + (i % 2 ? 12 : 0));
      out.set(id, [x, y, z]);
    });
  }
  return out;
}

function fibonacciSphere(i: number, n: number, radius: number, spreadX: number): LayoutXyz {
  const k = n === 1 ? 0.5 : i + 0.5;
  const y = 1 - (k / n) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * GOLDEN;
  return [Math.cos(a) * r * radius * spreadX, y * radius, Math.sin(a) * r * radius];
}

function globeLayout(nodes: readonly LayoutNode[], spreadX: number): Map<string, LayoutXyz> {
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const role = ROLE_RING.includes(n.role as typeof ROLE_RING[number]) ? n.role : "other";
    const list = groups.get(role) ?? [];
    list.push(n);
    groups.set(role, list);
  }
  const out = new Map<string, LayoutXyz>();
  ROLE_RING.forEach((role, ring) => {
    const list = groups.get(role);
    if (!list?.length) return;
    const R = 70 + ring * 70;
    list.forEach((n, i) => out.set(n.id, fibonacciSphere(i, list.length, R, spreadX)));
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

function barsLayout(nodes: readonly LayoutNode[], spreadX: number): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
  const cols = Math.max(3, Math.ceil(Math.sqrt(ranked.length || 1)));
  const maxRate = Math.max(1, ...ranked.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * 58 * spreadX;
    const z = (r - (Math.ceil(ranked.length / cols) - 1) / 2) * 58;
    const h = 12 + ((n.rate ?? 0) / maxRate) * 220;
    out.set(n.id, [x, h, z]);
  });
  return out;
}

function scatterLayout(nodes: readonly LayoutNode[], spreadX: number): Map<string, LayoutXyz> {
  const maxIn = Math.max(1, ...nodes.map((n) => n.bytesIn ?? 0));
  const maxOut = Math.max(1, ...nodes.map((n) => n.bytesOut ?? 0));
  const maxRate = Math.max(1, ...nodes.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const role = ROLE_RING.indexOf(n.role as typeof ROLE_RING[number]);
    const x = (((n.bytesIn ?? 0) / maxIn) * 2 - 1) * 240 * spreadX;
    const y = ((n.rate ?? 0) / maxRate) * 220;
    const z = role >= 0
      ? (role / Math.max(1, ROLE_RING.length - 1) - 0.5) * 360
      : (((n.bytesOut ?? 0) / maxOut) * 2 - 1) * 240;
    out.set(n.id, [x, y, z]);
  }
  return out;
}

function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function roleIndex(role: string): number {
  const i = ROLE_RING.indexOf(role as typeof ROLE_RING[number]);
  return i >= 0 ? i : ROLE_RING.length - 1;
}

function strandOf(role: string): 0 | 1 {
  return role === "internet" || role === "multicast" || role === "other" ? 1 : 0;
}

/** Double helix — LAN/self vs internet wind opposite strands. */
function helixLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = Math.max(1, ranked.length);
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((node, i) => {
    const strand = strandOf(node.role);
    const t = (i / n) * Math.PI * 4 + time * 0.45 + strand * Math.PI;
    const R = 70 + strand * 18;
    const y = flatten ? (strand ? 10 : -10) : (i / n - 0.5) * 320;
    out.set(node.id, [Math.cos(t) * R * spreadX, y, Math.sin(t) * R]);
  });
  return out;
}

/** Tornado — busier nodes climb, radius shrinks, the column spins. */
function vortexLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const maxRate = Math.max(1, ...nodes.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const climb = (n.rate ?? 0) / maxRate;
    const y = flatten ? 0 : 20 + climb * 260;
    const R = 28 + (1 - climb) * 200;
    const a = hash01(n.id) * Math.PI * 2 + time * (0.55 + climb * 0.9);
    out.set(n.id, [Math.cos(a) * R * spreadX, y, Math.sin(a) * R]);
  }
  return out;
}

/** Flower — hub pistil, role petals that breathe on pulse. */
function bloomLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  time: number,
  pulse: number,
): Map<string, LayoutXyz> {
  const open = 0.62 + 0.38 * Math.sin(time * 0.9) + 0.18 * pulse;
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    if (n.id === hub) continue;
    const role = ROLE_RING.includes(n.role as typeof ROLE_RING[number]) ? n.role : "other";
    const list = groups.get(role) ?? [];
    list.push(n);
    groups.set(role, list);
  }
  const petals = ROLE_RING.filter((r) => groups.has(r));
  const out = new Map<string, LayoutXyz>();
  if (hub) out.set(hub, [0, flatten ? 0 : 16 + pulse * 20, 0]);
  petals.forEach((role, pi) => {
    const list = groups.get(role)!;
    const a0 = (pi / Math.max(1, petals.length)) * Math.PI * 2 - Math.PI / 2;
    list.forEach((n, i) => {
      const u = (i + 1) / (list.length + 1);
      const r = (70 + u * 150) * open;
      const a = a0 + (i - (list.length - 1) / 2) * 0.22;
      const y = flatten ? 0 : Math.sin(u * Math.PI) * 70 * open;
      out.set(n.id, [Math.cos(a) * r * spreadX, y, Math.sin(a) * r]);
    });
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  void links;
  return out;
}

/** Hop rings from the hub that expand and contract. */
function rippleLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    const d = depthOf(n.id, parent);
    const list = layers.get(d) ?? [];
    list.push(n.id);
    layers.set(d, list);
  }
  const out = new Map<string, LayoutXyz>();
  for (const [d, list] of layers) {
    list.sort();
    const wave = Math.sin(time * 2.1 - d * 0.85);
    const R = d === 0 ? 0 : 55 + d * 78 + wave * 16;
    list.forEach((id, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + d * 0.2;
      const y = flatten ? 0 : wave * 14;
      out.set(id, [Math.cos(a) * R * spreadX, y, Math.sin(a) * R]);
    });
  }
  return out;
}

/** Loom — roles as warp, talkers as weft. */
function weaveLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const groups = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const k = roleIndex(n.role);
    const list = groups.get(k) ?? [];
    list.push(n);
    groups.set(k, list);
  }
  const cols = [...groups.keys()].sort((a, b) => a - b);
  const out = new Map<string, LayoutXyz>();
  cols.forEach((col, ci) => {
    const list = groups.get(col)!.slice().sort((a, b) => a.id.localeCompare(b.id));
    const x = (ci - (cols.length - 1) / 2) * 92 * spreadX;
    list.forEach((n, i) => {
      const z = (i - (list.length - 1) / 2) * 52;
      const y = flatten ? 0 : 14 * Math.sin(x * 0.018 + z * 0.02 + time * 1.4 + ci);
      out.set(n.id, [x, y, z]);
    });
  });
  return out;
}

/** Waterfall — role lanes, traffic falls and wraps. */
function cascadeLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const groups = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const k = roleIndex(n.role);
    const list = groups.get(k) ?? [];
    list.push(n);
    groups.set(k, list);
  }
  const cols = [...groups.keys()].sort((a, b) => a - b);
  const out = new Map<string, LayoutXyz>();
  cols.forEach((col, ci) => {
    const list = groups.get(col)!.slice().sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
    const x = (ci - (cols.length - 1) / 2) * 88 * spreadX;
    const span = Math.max(1, list.length);
    list.forEach((n, i) => {
      const fall = ((i / span) + time * 0.12) % 1;
      const y = flatten ? 0 : 140 - fall * 280;
      const z = (hash01(n.id) - 0.5) * 36;
      out.set(n.id, [x, y, z]);
    });
  });
  return out;
}

/** (3,2) torus knot — nodes slide along the loop. */
function knotLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = Math.max(1, ranked.length);
  const p = 3, q = 2;
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((node, i) => {
    const t = (i / n) * Math.PI * 2 + time * 0.28;
    const r = 90 + 42 * Math.cos(q * t);
    const x = r * Math.cos(p * t) * spreadX;
    const z = r * Math.sin(p * t);
    const y = flatten ? 0 : 52 * Math.sin(q * t);
    out.set(node.id, [x, y, z]);
  });
  return out;
}

/** Two cones — inbound above the pinch, outbound below. */
function hourglassLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const max = Math.max(1, ...nodes.map((n) => Math.max(n.bytesIn ?? 0, n.bytesOut ?? 0, n.rate ?? 0)));
  const out = new Map<string, LayoutXyz>();
  nodes.forEach((n, i) => {
    const inn = n.bytesIn ?? 0;
    const outb = n.bytesOut ?? 0;
    const sign = inn >= outb ? 1 : -1;
    const mag = Math.max(inn, outb, n.rate ?? 0) / max;
    const y = flatten ? 0 : sign * (28 + mag * 170);
    const R = 22 + (1 - mag) * 150;
    const a = hash01(n.id) * Math.PI * 2 + time * 0.2 * sign;
    out.set(n.id, [Math.cos(a) * R * spreadX, y, Math.sin(a) * R]);
    void i;
  });
  return out;
}

/** Living branch — spanning tree grows and twists from the hub. */
function coralLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const kids = childrenOf(parent);
  const out = new Map<string, LayoutXyz>();
  const place = (id: string, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, depth: number) => {
    out.set(id, [ox, oy, oz]);
    const child = kids.get(id) ?? [];
    const len = Math.max(42, 86 - depth * 10);
    child.forEach((c, i) => {
      const fan = (i - (child.length - 1) / 2) * 0.55 + time * 0.09;
      const tilt = flatten ? 0 : 0.35 + depth * 0.08;
      const ndx = dx * Math.cos(fan) - dz * Math.sin(fan);
      const ndz = dx * Math.sin(fan) + dz * Math.cos(fan);
      const ndy = flatten ? 0 : dy * Math.cos(tilt) + 0.45;
      const nl = Math.hypot(ndx, ndy, ndz) || 1;
      place(c, ox + (ndx / nl) * len * spreadX, oy + (ndy / nl) * len, oz + (ndz / nl) * len, ndx / nl, ndy / nl, ndz / nl, depth + 1);
    });
  };
  if (hub) place(hub, 0, flatten ? 0 : 40, 0, 0, 1, 0, 0);
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

/** Sea surface — role grid riding two crossing swells. */
function tideLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
  pulse: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => roleIndex(a.role) - roleIndex(b.role) || a.id.localeCompare(b.id));
  const cols = Math.max(3, Math.ceil(Math.sqrt(ranked.length || 1)));
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = (c - (cols - 1) / 2) * 62 * spreadX;
    const z = (r - (Math.ceil(ranked.length / cols) - 1) / 2) * 62;
    const y = flatten ? 0 : 18 * Math.sin(x * 0.022 + time * 1.1) + 14 * Math.cos(z * 0.019 + time * 0.85) + pulse * 16;
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** Möbius strip — one-sided walk that flips as it turns. */
function mobiusLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const n = Math.max(1, ranked.length);
  const R = 150;
  const w = 48;
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((node, i) => {
    const u = (i / n) * Math.PI * 2 + time * 0.22;
    const v = (hash01(node.id) - 0.5) * 2;
    const half = u / 2;
    const x = (R + v * w * Math.cos(half)) * Math.cos(u) * spreadX;
    const z = (R + v * w * Math.cos(half)) * Math.sin(u);
    const y = flatten ? 0 : v * w * Math.sin(half);
    out.set(node.id, [x, y, z]);
  });
  return out;
}

/** Vertebral column — hops as discs, siblings as ribs. */
function spineLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const kids = childrenOf(parent);
  const out = new Map<string, LayoutXyz>();
  const layers = new Map<number, string[]>();
  let maxD = 0;
  for (const n of nodes) {
    const d = depthOf(n.id, parent);
    maxD = Math.max(maxD, d);
    const list = layers.get(d) ?? [];
    list.push(n.id);
    layers.set(d, list);
  }
  for (const [d, list] of layers) {
    list.sort();
    const z = (d - maxD * 0.35) * 78;
    const sway = Math.sin(time * 0.7 + d * 0.4) * 10;
    list.forEach((id, i) => {
      const rib = i - (list.length - 1) / 2;
      const x = rib * 54 * spreadX + sway;
      const y = flatten ? 0 : 8 + Math.sin(time + i) * 6;
      out.set(id, [x, y, z]);
    });
  }
  void kids;
  return out;
}

/** Nested role rings stacked in height, each spinning at its own rate. */
function haloLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const role = ROLE_RING.includes(n.role as typeof ROLE_RING[number]) ? n.role : "other";
    const list = groups.get(role) ?? [];
    list.push(n);
    groups.set(role, list);
  }
  const out = new Map<string, LayoutXyz>();
  ROLE_RING.forEach((role, ring) => {
    const list = groups.get(role);
    if (!list?.length) return;
    const R = 50 + ring * 48;
    const y = flatten ? 0 : (ring - 3) * 36;
    const spin = time * (0.18 + ring * 0.07) * (ring % 2 ? -1 : 1);
    list.forEach((n, i) => {
      const a = (i / list.length) * Math.PI * 2 + spin;
      out.set(n.id, [Math.cos(a) * R * spreadX, y, Math.sin(a) * R]);
    });
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

/** Accordion crease — nodes ride a zigzag paper fold. */
function foldLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const out = new Map<string, LayoutXyz>();
  const crease = 70;
  ranked.forEach((n, i) => {
    const cell = Math.floor(i / 2);
    const side = i % 2 ? 1 : -1;
    const x = side * crease * spreadX;
    const z = cell * 48 - ranked.length * 12;
    const lift = flatten ? 0 : 22 * Math.sin(time * 1.3 + cell * 0.5);
    out.set(n.id, [x, lift, z]);
  });
  return out;
}

/** Laminar river — role streams flowing along Z. */
function driftLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const groups = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const k = roleIndex(n.role);
    const list = groups.get(k) ?? [];
    list.push(n);
    groups.set(k, list);
  }
  const cols = [...groups.keys()].sort((a, b) => a - b);
  const out = new Map<string, LayoutXyz>();
  cols.forEach((col, ci) => {
    const list = groups.get(col)!.slice().sort((a, b) => a.id.localeCompare(b.id));
    const x = (ci - (cols.length - 1) / 2) * 80 * spreadX;
    const span = Math.max(1, list.length);
    list.forEach((n, i) => {
      const flow = ((i / span) + time * 0.08) % 1;
      const z = (flow - 0.5) * 360;
      const y = flatten ? 0 : 10 * Math.sin(flow * Math.PI * 2 + ci);
      out.set(n.id, [x, y, z]);
    });
  });
  return out;
}

function degreesOf(nodes: readonly LayoutNode[], links: readonly LayoutLink[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const n of nodes) d.set(n.id, n.degree ?? 0);
  if ([...d.values()].some((v) => v > 0)) return d;
  for (const l of links) {
    d.set(l.a, (d.get(l.a) ?? 0) + 1);
    d.set(l.b, (d.get(l.b) ?? 0) + 1);
  }
  return d;
}

function dftMags(samples: readonly number[]): number[] {
  const n = samples.length;
  const out = new Array(n).fill(0);
  if (!n) return out;
  for (let k = 0; k < n; k++) {
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      const v = samples[t] ?? 0;
      re += v * Math.cos(a);
      im += v * Math.sin(a);
    }
    out[k] = Math.hypot(re, im) / n;
  }
  return out;
}

function spectrumBins(n: number, bins?: readonly number[], rates?: readonly number[]): number[] {
  if (bins && bins.some((v) => v > 0.002)) {
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) out[i] = bins[i % bins.length] ?? 0;
    return out;
  }
  const src = rates && rates.length ? rates : new Array(n).fill(0);
  const mags = dftMags(src);
  const max = Math.max(1e-6, ...mags);
  return mags.map((v) => v / max);
}

function hilbertXY(index: number, order: number): [number, number] {
  let x = 0, y = 0;
  let t = index;
  for (let s = 1; s < (1 << order); s <<= 1) {
    const rx = 1 & (t >> 1);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t >>= 2;
  }
  return [x, y];
}

function kochPoint(t: number, order: number): [number, number] {
  let pts: [number, number][] = [[0, 0], [1, 0]];
  for (let o = 0; o < order; o++) {
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      const dx = bx - ax, dy = by - ay;
      const p1: [number, number] = [ax + dx / 3, ay + dy / 3];
      const p3: [number, number] = [ax + (2 * dx) / 3, ay + (2 * dy) / 3];
      const p2: [number, number] = [
        (p1[0] + p3[0]) / 2 - (dy / 3) * (Math.sqrt(3) / 2),
        (p1[1] + p3[1]) / 2 + (dx / 3) * (Math.sqrt(3) / 2),
      ];
      next.push([ax, ay], p1, p2, p3);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  const u = Math.min(0.9999, Math.max(0, t)) * (pts.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  const a = pts[i]!, b = pts[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function ipv4Parts(id: string): number[] | null {
  const m = id.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/** Sierpinski gasket — hop depth picks the IFS vertex. */
function sierpinskiLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  pulse: number,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const verts: LayoutXyz[] = [[0, 0, 140], [-160 * spreadX, 0, -90], [160 * spreadX, 0, -90]];
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const d = depthOf(n.id, parent);
    let x = 0, y = flatten ? 0 : 8 + pulse * 12, z = 0;
    let seed = Math.floor(hash01(n.id) * 1e9);
    const steps = 6 + Math.min(8, d);
    for (let i = 0; i < steps; i++) {
      const v = verts[seed % 3]!;
      x = (x + v[0]) / 2;
      z = (z + v[2]) / 2;
      if (!flatten) y = (y + (d % 3) * 18) / 2;
      seed = Math.floor(seed / 3);
    }
    out.set(n.id, [x, y, z]);
  }
  return out;
}

/** Hilbert curve — rate-ranked talkers stay spatially close. */
function hilbertLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
  const order = Math.max(2, Math.ceil(Math.log2(Math.sqrt(Math.max(1, ranked.length))) + 1e-9));
  const span = 1 << order;
  const maxRate = Math.max(1, ...ranked.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const [hx, hz] = hilbertXY(i, order);
    const x = ((hx / Math.max(1, span - 1)) - 0.5) * 320 * spreadX;
    const z = ((hz / Math.max(1, span - 1)) - 0.5) * 320;
    const y = flatten ? 0 : ((n.rate ?? 0) / maxRate) * 90;
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** Koch flake — spanning-tree walk along a fractal coastline. */
function kochLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const leaf = leafWalk(hub, childrenOf(parent), new Set(ids));
  const xs = [...leaf.values()];
  const lo = xs.length ? Math.min(...xs) : 0;
  const hi = xs.length ? Math.max(...xs) : 1;
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const t = ((leaf.get(n.id) ?? 0) - lo) / Math.max(1, hi - lo);
    const [kx, ky] = kochPoint((t + time * 0.015) % 1, 3);
    const x = (kx - 0.5) * 360 * spreadX;
    const z = (ky - 0.15) * 360;
    const y = flatten ? 0 : depthOf(n.id, parent) * 16;
    out.set(n.id, [x, y, z]);
  }
  return out;
}

/** Julia set — id is the seed, escape time is height. */
function juliaLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
): Map<string, LayoutXyz> {
  const cx = -0.8 + 0.06 * Math.sin(time * 0.15);
  const cy = 0.156;
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    let zx = (hash01(n.id) * 2.4 - 1.2);
    let zy = (hash01(n.id + ":") * 2.4 - 1.2);
    let iter = 0;
    const cap = 18;
    while (zx * zx + zy * zy < 4 && iter < cap) {
      const nx = zx * zx - zy * zy + cx;
      zy = 2 * zx * zy + cy;
      zx = nx;
      iter++;
    }
    const y = flatten ? 0 : 12 + (1 - iter / cap) * 200 + Math.log10(1 + (n.rate ?? 0)) * 8;
    out.set(n.id, [zx * 140 * spreadX, y, zy * 140]);
  }
  return out;
}

/** FFT spectrum — X is frequency, height is power. */
function spectrumLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  bins: readonly number[] | undefined,
  pulse: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
  const rates = ranked.map((n) => Math.log10(1 + (n.rate ?? 0)));
  const spec = spectrumBins(ranked.length, bins, rates);
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const x = ((i / Math.max(1, ranked.length - 1)) - 0.5) * 360 * spreadX;
    const power = spec[i] ?? 0;
    const y = flatten ? 0 : 16 + power * 220 + pulse * 20;
    const z = (hash01(n.id) - 0.5) * 28;
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** Radio waterfall — frequency × time. */
function waterfallLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
  bins: readonly number[] | undefined,
  frames: readonly number[][] | undefined,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (a.chan ?? 0) - (b.chan ?? 0) || (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
  const rates = ranked.map((n) => Math.log10(1 + (n.rate ?? 0)));
  const spec = spectrumBins(32, bins, rates);
  const hist = frames && frames.length ? frames : [spec];
  const rows = Math.max(1, hist.length);
  const cols = 32;
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const col = n.chan && n.chan > 0 ? Math.min(cols - 1, Math.round((n.chan / 165) * (cols - 1))) : i % cols;
    const row = Math.floor(i / cols) % rows;
    const frame = hist[hist.length - 1 - row] ?? spec;
    const power = frame[col % frame.length] ?? spec[col] ?? 0;
    const x = ((col / Math.max(1, cols - 1)) - 0.5) * 340 * spreadX;
    const z = ((row / Math.max(1, rows - 1)) - 0.5) * 260 - (time % 4) * 8;
    const y = flatten ? 0 : 10 + power * 200;
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** AM carrier — nodes ride a sine; envelope is live rate. */
function carrierLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
  pulse: number,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const maxRate = Math.max(1, ...ranked.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const u = i / Math.max(1, ranked.length - 1);
    const x = (u - 0.5) * 360 * spreadX;
    const env = 0.35 + 0.65 * ((n.rate ?? 0) / maxRate);
    const y = flatten ? 0 : env * (70 + pulse * 40) * Math.sin(u * Math.PI * 6 + time * 2.4);
    const z = (hash01(n.id) - 0.5) * 24;
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** Phased array — line of elements, phase from FFT / channel. */
function phasedLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
  time: number,
  bins: readonly number[] | undefined,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (a.chan ?? 99) - (b.chan ?? 99) || a.id.localeCompare(b.id));
  const rates = ranked.map((n) => Math.log10(1 + (n.rate ?? 0)));
  const spec = spectrumBins(ranked.length, bins, rates);
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const x = ((i / Math.max(1, ranked.length - 1)) - 0.5) * 340 * spreadX;
    const phase = (n.chan ?? i) * 0.35 + time * 1.6;
    const steer = spec[i] ?? 0;
    const y = flatten ? 0 : 24 + Math.sin(phase) * (40 + steer * 120);
    const z = Math.cos(phase) * (30 + steer * 80);
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** Binary max-heap — busiest talker at the root. */
function heapLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const heap = [...nodes].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(b.id));
  const out = new Map<string, LayoutXyz>();
  const leafX = new Map<number, number>();
  const walk = (i: number): number => {
    const L = 2 * i + 1, R = 2 * i + 2;
    if (L >= heap.length) {
      const x = leafX.size;
      leafX.set(i, x);
      return x;
    }
    const a = walk(L);
    const b = R < heap.length ? walk(R) : a;
    const x = (a + b) / 2;
    leafX.set(i, x);
    return x;
  };
  if (heap.length) walk(0);
  const xs = [...leafX.values()];
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  heap.forEach((n, i) => {
    const level = Math.floor(Math.log2(i + 1));
    const x = ((leafX.get(i) ?? 0) - mid) * 56 * spreadX;
    const z = level * 70;
    const y = flatten ? 0 : Math.max(0, 140 - level * 28);
    out.set(n.id, [x, y, z]);
  });
  return out;
}

/** IPv4 prefix trie — octets as digits. */
function trieLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  type Box = { kids: Map<number, Box>; nodes: LayoutNode[] };
  const root: Box = { kids: new Map(), nodes: [] };
  for (const n of nodes) {
    const parts = ipv4Parts(n.ip ?? n.id);
    if (!parts) {
      root.nodes.push(n);
      continue;
    }
    let cur = root;
    for (const p of parts.slice(0, 3)) {
      let next = cur.kids.get(p);
      if (!next) { next = { kids: new Map(), nodes: [] }; cur.kids.set(p, next); }
      cur = next;
    }
    cur.nodes.push(n);
  }
  const out = new Map<string, LayoutXyz>();
  const place = (box: Box, x0: number, x1: number, depth: number) => {
    const keys = [...box.kids.keys()].sort((a, b) => a - b);
    const width = x1 - x0;
    keys.forEach((k, i) => {
      const a = x0 + (i / Math.max(1, keys.length)) * width;
      const b = x0 + ((i + 1) / Math.max(1, keys.length)) * width;
      place(box.kids.get(k)!, a, b, depth + 1);
    });
    box.nodes.sort((a, b) => a.id.localeCompare(b.id));
    box.nodes.forEach((n, i) => {
      const x = ((x0 + x1) / 2 + (i - (box.nodes.length - 1) / 2) * 18) * spreadX;
      const z = depth * 80;
      const y = flatten ? 0 : 8 + i * 6;
      out.set(n.id, [x, y, z]);
    });
  };
  place(root, -180, 180, 0);
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

/** Hash table — tall stacks are collisions. */
function hashmapLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const buckets = Math.max(6, Math.ceil(Math.sqrt(nodes.length * 1.6)));
  const slots = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const b = Math.floor(hash01(n.id) * buckets);
    const list = slots.get(b) ?? [];
    list.push(n);
    slots.set(b, list);
  }
  const out = new Map<string, LayoutXyz>();
  for (let b = 0; b < buckets; b++) {
    const list = (slots.get(b) ?? []).sort((a, c) => (c.rate ?? 0) - (a.rate ?? 0) || a.id.localeCompare(c.id));
    const x = ((b / Math.max(1, buckets - 1)) - 0.5) * 340 * spreadX;
    list.forEach((n, i) => {
      const y = flatten ? 0 : 14 + i * 28;
      const z = (list.length - 1) * 6;
      out.set(n.id, [x, y, z]);
    });
  }
  return out;
}

/** Feature matrix — degree × hop, height is rate. */
function matrixLayout(
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  hub: string,
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ids = nodes.map((n) => n.id);
  const parent = spanningParents(ids, links, hub);
  const deg = degreesOf(nodes, links);
  const maxD = Math.max(1, ...deg.values());
  const maxH = Math.max(1, ...nodes.map((n) => depthOf(n.id, parent)));
  const maxRate = Math.max(1, ...nodes.map((n) => n.rate ?? 0));
  const out = new Map<string, LayoutXyz>();
  for (const n of nodes) {
    const x = ((deg.get(n.id) ?? 0) / maxD - 0.5) * 320 * spreadX;
    const z = (depthOf(n.id, parent) / maxH - 0.5) * 280;
    const y = flatten ? 0 : 12 + ((n.rate ?? 0) / maxRate) * 200;
    out.set(n.id, [x, y, z]);
  }
  return out;
}

/** FIFO by last-seen — newest at the head. */
function queueLayout(
  nodes: readonly LayoutNode[],
  spreadX: number,
  flatten: boolean,
): Map<string, LayoutXyz> {
  const ranked = [...nodes].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.id.localeCompare(b.id));
  const out = new Map<string, LayoutXyz>();
  ranked.forEach((n, i) => {
    const x = (i - (ranked.length - 1) / 2) * 36 * spreadX;
    const y = flatten ? 0 : Math.log10(1 + (n.rate ?? 0)) * 28;
    out.set(n.id, [x, y, 0]);
  });
  return out;
}

export function pullTowardLayout<T extends { id: string; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }>(
  nodes: T[],
  targets: Map<string, LayoutXyz>,
  alpha: number,
  k = 0.22,
): void {
  const s = k * alpha;
  for (const n of nodes) {
    const t = targets.get(n.id);
    if (!t) continue;
    n.vx = (n.vx ?? 0) + (t[0] - (n.x ?? 0)) * s;
    n.vy = (n.vy ?? 0) + (t[1] - (n.y ?? 0)) * s;
    n.vz = (n.vz ?? 0) + (t[2] - (n.z ?? 0)) * s;
  }
}
