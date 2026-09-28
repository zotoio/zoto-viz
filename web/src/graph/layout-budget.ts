import { isSysBase, type ViewMode } from "../core/modes";

/** Main pane force-layout body ceiling. Labels are capped separately. */
export const LAYOUT_BODY_MAIN = 96;
/** Satellite mosaic pane ceiling. Sys graphs are already under this. */
export const LAYOUT_BODY_SATELLITE = 48;

export function layoutBodyBudget(satellite: boolean): number {
  return satellite ? LAYOUT_BODY_SATELLITE : LAYOUT_BODY_MAIN;
}

/**
 * True when the view lays out the full device table (topology, watch, talkers, …).
 * Wi-Fi, Bluetooth, CPU, sources, and SYS slices stay uncapped — they are already small.
 * Stage-only panes do not draw the graph.
 */
export function usesFullDeviceTable(mode: Pick<ViewMode, "standalone" | "stageOnly" | "graphBase">): boolean {
  if (mode.standalone || mode.stageOnly) return false;
  const base = mode.graphBase;
  if (base === "wifi" || base === "bluetooth" || base === "cpu" || base === "sources" || isSysBase(base)) return false;
  return true;
}

export interface LayoutBodyPick {
  id: string;
  role: string;
  bytes: number;
  rate: number;
  selected?: boolean;
}

export interface LayoutBodyLink {
  a: string;
  b: string;
}

/**
 * Bodies that enter the force worker. Gateway, self, and the selection are kept first,
 * then their link endpoints, then everyone else by bytes and rate. The result never
 * exceeds `budget`, so a wall of offline internet hosts cannot fill the simulation.
 */
export function selectLayoutBodyIds(
  nodes: readonly LayoutBodyPick[],
  links: readonly LayoutBodyLink[],
  budget: number,
): Set<string> {
  if (budget <= 0) return new Set();
  if (nodes.length <= budget) return new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rank = (n: LayoutBodyPick) => n.bytes + n.rate;
  const byRank = [...nodes].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
  const have = new Set<string>();
  const take = (id: string) => {
    if (have.size >= budget || have.has(id) || !byId.has(id)) return;
    have.add(id);
  };
  for (const n of byRank) {
    if (n.role === "gateway" || n.role === "self" || n.selected) take(n.id);
  }
  const pinned = [...have];
  const neighborRank = new Map<string, number>();
  for (const l of links) {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    if (pinned.includes(l.a) && !have.has(l.b)) neighborRank.set(l.b, Math.max(neighborRank.get(l.b) ?? 0, rank(b)));
    if (pinned.includes(l.b) && !have.has(l.a)) neighborRank.set(l.a, Math.max(neighborRank.get(l.a) ?? 0, rank(a)));
  }
  const neighbors = [...neighborRank.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  for (const [id] of neighbors) take(id);
  for (const n of byRank) take(n.id);
  return have;
}
