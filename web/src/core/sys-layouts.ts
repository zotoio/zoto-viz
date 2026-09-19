/**
 * SYS graph placements. Each host view uses the chart that matches the data:
 * part-of-whole, bars, podium, bipartite, tree, status grid, class clusters.
 * Pure: ids in, xyz out. The scene force only pulls toward these targets.
 */

export type SysLayoutNode = {
  id: string;
  role: string;
  vendor?: string;
  cpu?: number;
  bytes_in?: number;
  ports?: string[];
};

export type SysLayoutLink = { a: string; b: string };

export type Xyz = [number, number, number];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function pullToward<T extends { id: string; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }>(
  nodes: T[],
  targets: Map<string, Xyz>,
  alpha: number,
  k = 0.16,
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

function fitPlanar(out: Map<string, Xyz>, maxX = 300, maxZ = 240): void {
  let minX = 0, maxXv = 0, minZ = 0, maxZv = 0;
  for (const t of out.values()) {
    minX = Math.min(minX, t[0]);
    maxXv = Math.max(maxXv, t[0]);
    minZ = Math.min(minZ, t[2]);
    maxZv = Math.max(maxZv, t[2]);
  }
  const sx = maxXv - minX > maxX ? maxX / (maxXv - minX) : 1;
  const sz = maxZv - minZ > maxZ ? maxZ / (maxZv - minZ) : 1;
  const s = Math.min(sx, sz);
  if (s >= 1) return;
  for (const [id, t] of out) out.set(id, [t[0] * s, t[1], t[2] * s]);
}

function row(ids: string[], y: number, z: number, spacing: number, spreadX: number): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const n = ids.length;
  if (!n) return out;
  const sx = Math.min(spacing, 1100 / n) * spreadX;
  ids.forEach((id, i) => {
    out.set(id, [(i - (n - 1) / 2) * sx, y, z]);
  });
  return out;
}

/** 2D packed bubbles: hub + PSI ring, processes on a phyllotaxis disc sized by RSS. */
export function memoryBubbles(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const hub = nodes.find((n) => n.id === "mem:host" || n.role === "self");
  const psi = nodes.filter((n) => n.id.startsWith("psi:") || n.id === "mem:swap");
  const procs = nodes
    .filter((n) => n.id.startsWith("mem:proc:"))
    .sort((a, b) => (b.bytes_in ?? 0) - (a.bytes_in ?? 0));
  if (hub) out.set(hub.id, [0, 0, 0]);
  psi.forEach((n, i) => {
    const a = (i / Math.max(1, psi.length)) * Math.PI * 2 - Math.PI / 2;
    out.set(n.id, [Math.cos(a) * 70 * spreadX, 0, Math.sin(a) * 70]);
  });
  procs.forEach((n, i) => {
    const r = 120 + 16 * Math.sqrt(i);
    const a = i * GOLDEN;
    out.set(n.id, [Math.cos(a) * r * spreadX, 0, Math.sin(a) * r]);
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

/** 3D bar chart: block devices as columns, I/O processes as a front row. */
export function diskColumns(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const hub = nodes.find((n) => n.id === "disk:host" || n.role === "self");
  const disks = nodes.filter((n) => n.vendor === "block" || (n.id.startsWith("disk:") && !n.id.startsWith("disk:proc:") && n.id !== "disk:host"));
  const procs = nodes.filter((n) => n.id.startsWith("disk:proc:"));
  const out = new Map<string, Xyz>();
  if (hub) out.set(hub.id, [0, 4, 80]);
  disks.forEach((n, i) => {
    const x = (i - (disks.length - 1) / 2) * 70 * spreadX;
    out.set(n.id, [x, 50 + (n.cpu ?? 0) * 2.2, 0]);
  });
  procs.forEach((n, i) => {
    const x = (i - (procs.length - 1) / 2) * 36 * spreadX;
    out.set(n.id, [x, 8, 70]);
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 8, 150]);
  return out;
}

/** 3D podium: host at the floor, each GPU a large card on a front arc. */
export function gpuPodium(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const hub = nodes.find((n) => n.id === "gpu:host" || n.role === "self");
  const cards = nodes.filter((n) => n.id.startsWith("gpu:") && n.id !== "gpu:host");
  if (hub) out.set(hub.id, [0, 4, 160]);
  const n = Math.max(1, cards.length);
  cards.forEach((c, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    out.set(c.id, [t * 220 * spreadX, 48 + (c.cpu ?? 0) * 1.4, -20]);
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 4, 160]);
  return out;
}

/** 2D bipartite: processes on the left, remote peers on the right. */
export function socketBipartite(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const hub = nodes.find((n) => n.id === "sock:host" || n.role === "self");
  const procs = nodes.filter((n) => n.id.startsWith("sock:proc:"));
  const peers = nodes.filter((n) => n.id.startsWith("sock:peer:"));
  if (hub) out.set(hub.id, [0, 0, 0]);
  const left = row(procs.map((n) => n.id), 0, 0, 48, 1);
  for (const [id, t] of left) out.set(id, [-210 * spreadX, t[1], t[0]]);
  const right = row(peers.map((n) => n.id), 0, 0, 42, 1);
  for (const [id, t] of right) {
    const peer = peers.find((p) => p.id === id);
    const x = (peer?.role === "internet" ? 260 : 200) * spreadX;
    out.set(id, [x, t[1], t[0]]);
  }
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

export function cgroupParent(id: string, hub = "cg:root", known?: Set<string>): string | null {
  if (id === hub) return null;
  if (!id.startsWith("cg:")) return hub;
  const rest = id.slice(3);
  const slash = rest.lastIndexOf("/");
  if (slash < 0) return hub;
  const pathParent = `cg:${rest.slice(0, slash)}`;
  if (!known || known.has(pathParent)) return pathParent;
  const leaf = rest.slice(0, slash).split("/").pop();
  const stub = leaf ? `cg:${leaf}` : pathParent;
  return known.has(stub) ? stub : pathParent;
}

/** 2D layered tree: depth along Z, siblings along X (cgroup paths). */
export function cgroupTree(nodes: SysLayoutNode[], spreadX = 1, hub = "cg:root"): Map<string, Xyz> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const children = new Map<string, string[]>();
  const parent = new Map<string, string | null>();
  for (const id of ids) {
    const p = cgroupParent(id, hub, idSet);
    parent.set(id, p && idSet.has(p) ? p : id === hub ? null : hub);
    const pid = parent.get(id);
    if (!pid) continue;
    const list = children.get(pid) ?? [];
    list.push(id);
    children.set(pid, list);
  }
  const leafX = new Map<string, number>();
  let next = 0;
  const walk = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (!kids.length) {
      const x = next++;
      leafX.set(id, x);
      return x;
    }
    let sum = 0;
    for (const k of kids) sum += walk(k);
    const x = sum / kids.length;
    leafX.set(id, x);
    return x;
  };
  if (idSet.has(hub)) walk(hub);
  else ids.forEach((id) => { if (!parent.get(id)) walk(id); });
  const depthOf = (id: string): number => {
    let d = 0, cur: string | null | undefined = id;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = parent.get(cur);
      if (!p) break;
      d++;
      cur = p;
    }
    return d;
  };
  const xs = [...leafX.values()];
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const out = new Map<string, Xyz>();
  for (const id of ids) {
    const x = ((leafX.get(id) ?? 0) - mid) * 48 * spreadX;
    out.set(id, [x, 0, (depthOf(id) - 0.2) * 56]);
  }
  fitPlanar(out, 280 * spreadX, 220);
  return out;
}

/** 2D status grid: failed units on a top row, running units in a grid. */
export function unitGrid(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const hub = nodes.find((n) => n.id === "unit:host" || n.role === "self");
  const failed = nodes.filter((n) => n.id.startsWith("unit:") && n.id !== "unit:host" && n.role === "internet");
  const running = nodes.filter((n) => n.id.startsWith("unit:") && n.id !== "unit:host" && n.role !== "internet");
  if (hub) out.set(hub.id, [0, 0, -20]);
  failed.forEach((n, i) => {
    out.set(n.id, [(i - (failed.length - 1) / 2) * 70 * spreadX, 0, -40]);
  });
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(running.length || 1))));
  running.forEach((n, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = r === Math.floor((running.length - 1) / cols) ? running.length - r * cols : cols;
    out.set(n.id, [(c - (inRow - 1) / 2) * 62 * spreadX, 0, 50 + r * 70]);
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
  return out;
}

/** 3D class clusters: one ring per udev class (net, drm, block, …); new/gone sit higher/lower. */
export function udevClusters(nodes: SysLayoutNode[], spreadX = 1): Map<string, Xyz> {
  const out = new Map<string, Xyz>();
  const hub = nodes.find((n) => n.id === "udev:host" || n.role === "self");
  const items = nodes.filter((n) => n.id.startsWith("udev:") && n.id !== "udev:host");
  if (hub) out.set(hub.id, [0, 4, 0]);
  const groups = new Map<string, SysLayoutNode[]>();
  for (const n of items) {
    const kind = n.vendor || n.ports?.[0] || "dev";
    const g = groups.get(kind) ?? [];
    g.push(n);
    groups.set(kind, g);
  }
  const kinds = [...groups.keys()].sort();
  kinds.forEach((kind, gi) => {
    const ring = groups.get(kind)!;
    const cx = (gi - (kinds.length - 1) / 2) * 150 * spreadX;
    const R = 28 + Math.min(22, ring.length * 2);
    ring.forEach((n, i) => {
      const a = (i / Math.max(1, ring.length)) * Math.PI * 2 + gi * 0.4;
      const lift = n.role === "local" ? 78 : n.role === "internet" ? -56 : 14;
      out.set(n.id, [cx + Math.cos(a) * R, lift, Math.sin(a) * R]);
    });
  });
  for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 14, 0]);
  return out;
}

export type SysLayoutKind = "bubbles" | "columns" | "podium" | "bipartite" | "tree" | "grid" | "clusters";

export const SYS_LAYOUT_KIND: Record<string, SysLayoutKind> = {
  memory: "bubbles",
  disk: "columns",
  gpu: "podium",
  sockets: "bipartite",
  cgroups: "tree",
  units: "grid",
  udev: "clusters",
};
