import type { HeroPos, MosaicSize } from "./scene";
import { allocateMosaicTileSlot, mosaicTileViewId } from "./mosaic-tile-id";

/** Horizontal = left/right. Vertical = top/bottom. */
export type MosaicDir = "h" | "v";

export type MosaicLeaf = { type: "leaf"; id: string };
export type MosaicSplit = {
  type: "split";
  dir: MosaicDir;
  ratio: number;
  a: MosaicNode;
  b: MosaicNode;
};
export type MosaicNode = MosaicLeaf | MosaicSplit;

export const RATIO_MIN = 0.12;
export const RATIO_MAX = 0.88;
/** Matches the old 2.2fr / 1fr hero split. */
export const HERO_RATIO = 2.2 / 3.2;

export function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, n));
}

export function isLeaf(n: MosaicNode): n is MosaicLeaf {
  return n.type === "leaf";
}

export function leafIds(n: MosaicNode | null | undefined): string[] {
  if (!n) return [];
  if (n.type === "leaf") return [n.id];
  return [...leafIds(n.a), ...leafIds(n.b)];
}

export function cloneNode(n: MosaicNode): MosaicNode {
  if (n.type === "leaf") return { type: "leaf", id: n.id };
  return { type: "split", dir: n.dir, ratio: n.ratio, a: cloneNode(n.a), b: cloneNode(n.b) };
}

/** Structure + leaf ids, not ratios — resize must not look like a new wall. */
export function structureKey(n: MosaicNode | null | undefined): string {
  if (!n) return "";
  if (n.type === "leaf") return `L:${n.id}`;
  return `S:${n.dir}(${structureKey(n.a)}|${structureKey(n.b)})`;
}

export function parseMosaicNode(raw: unknown, depth = 0): MosaicNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || depth > 8) return null;
  const s = raw as Record<string, unknown>;
  if (s.type === "leaf" && typeof s.id === "string" && s.id.trim()) {
    return { type: "leaf", id: s.id.trim().slice(0, 80) };
  }
  if (s.type === "split" && (s.dir === "h" || s.dir === "v")) {
    const a = parseMosaicNode(s.a, depth + 1);
    const b = parseMosaicNode(s.b, depth + 1);
    if (!a || !b) return null;
    return { type: "split", dir: s.dir, ratio: clampRatio(Number(s.ratio)), a, b };
  }
  return null;
}

export function parseMosaicTiles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 8)) {
    if (typeof row !== "string" || !row.trim()) continue;
    const id = row.trim().slice(0, 96);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function rowTree(ids: string[]): MosaicNode {
  if (ids.length === 1) return { type: "leaf", id: ids[0]! };
  const mid = Math.ceil(ids.length / 2);
  return {
    type: "split",
    dir: "h",
    ratio: ids.length === 2 ? 0.5 : mid / ids.length,
    a: rowTree(ids.slice(0, mid)),
    b: rowTree(ids.slice(mid)),
  };
}

function stackRows(rows: MosaicNode[]): MosaicNode {
  if (rows.length === 1) return rows[0]!;
  const mid = Math.ceil(rows.length / 2);
  return {
    type: "split",
    dir: "v",
    ratio: rows.length === 2 ? 0.5 : mid / rows.length,
    a: stackRows(rows.slice(0, mid)),
    b: stackRows(rows.slice(mid)),
  };
}

/** Equal-ish CSS grid: `cols` across, remaining cells wrap. */
export function gridTree(ids: string[], cols: number): MosaicNode {
  if (!ids.length) return { type: "leaf", id: "" };
  const n = Math.max(1, Math.min(4, cols | 0));
  const rows: MosaicNode[] = [];
  for (let i = 0; i < ids.length; i += n) rows.push(rowTree(ids.slice(i, i + n)));
  return stackRows(rows);
}

function gridCols(count: number): number {
  if (count <= 2) return count || 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Center-hero leftover: 4→2+2, 6→4+2, 8→4+4 (same as the old wall). */
export function centerSplit(n: number): [number, number] {
  if (n <= 0) return [0, 0];
  if (n === 6) return [4, 2];
  if (n === 8 || n === 4) return [n / 2, n / 2];
  const left = Math.ceil(n / 2);
  return [left, n - left];
}

export function defaultTree(ids: string[], hero: HeroPos = "off"): MosaicNode | null {
  if (!ids.length) return null;
  if (ids.length === 1 || hero === "off") return gridTree(ids, gridCols(ids.length));
  const heroId = ids[0]!;
  const rest = ids.slice(1);
  const heroLeaf: MosaicLeaf = { type: "leaf", id: heroId };
  if (!rest.length) return heroLeaf;
  if (hero === "left") {
    return { type: "split", dir: "h", ratio: HERO_RATIO, a: heroLeaf, b: gridTree(rest, rest.length > 3 ? 2 : 1) };
  }
  if (hero === "right") {
    return { type: "split", dir: "h", ratio: 1 - HERO_RATIO, a: gridTree(rest, rest.length > 3 ? 2 : 1), b: heroLeaf };
  }
  const [leftN] = centerSplit(rest.length);
  const left = rest.slice(0, leftN);
  const right = rest.slice(leftN);
  const leftNode = left.length ? gridTree(left, left.length > 2 ? 2 : 1) : null;
  const rightNode = right.length ? gridTree(right, right.length > 2 ? 2 : 1) : null;
  if (leftNode && rightNode) {
    return {
      type: "split",
      dir: "h",
      ratio: 1 / (1 + 2.2 + 1),
      a: leftNode,
      b: { type: "split", dir: "h", ratio: HERO_RATIO, a: heroLeaf, b: rightNode },
    };
  }
  if (leftNode) return { type: "split", dir: "h", ratio: 1 - HERO_RATIO, a: leftNode, b: heroLeaf };
  if (rightNode) return { type: "split", dir: "h", ratio: HERO_RATIO, a: heroLeaf, b: rightNode };
  return heroLeaf;
}

/** Neighbour swallows the closed leaf so the wall stays gapless. */
export function closeLeaf(n: MosaicNode, id: string): MosaicNode | null {
  if (n.type === "leaf") return n.id === id ? null : cloneNode(n);
  if (n.a.type === "leaf" && n.a.id === id) return cloneNode(n.b);
  if (n.b.type === "leaf" && n.b.id === id) return cloneNode(n.a);
  const a = closeLeaf(n.a, id);
  const b = closeLeaf(n.b, id);
  if (!a) return b;
  if (!b) return a;
  return { type: "split", dir: n.dir, ratio: n.ratio, a, b };
}

export function swapLeaves(n: MosaicNode, a: string, b: string): MosaicNode {
  if (a === b) return cloneNode(n);
  const walk = (node: MosaicNode): MosaicNode => {
    if (node.type === "leaf") {
      if (node.id === a) return { type: "leaf", id: b };
      if (node.id === b) return { type: "leaf", id: a };
      return { type: "leaf", id: node.id };
    }
    return { type: "split", dir: node.dir, ratio: node.ratio, a: walk(node.a), b: walk(node.b) };
  };
  return walk(n);
}

export function mapLeaves(n: MosaicNode, ids: string[]): MosaicNode {
  let i = 0;
  const walk = (node: MosaicNode): MosaicNode => {
    if (node.type === "leaf") return { type: "leaf", id: ids[i++] ?? node.id };
    return { type: "split", dir: node.dir, ratio: node.ratio, a: walk(node.a), b: walk(node.b) };
  };
  return walk(cloneNode(n));
}

/** Swap two tile slots (leaf ids). */
export function movePaneTileView(ids: string[], fromSlot: string, otherSlot: string): string[] {
  const i = ids.indexOf(fromSlot);
  const j = ids.indexOf(otherSlot);
  if (i < 0 || j < 0 || i === j) return ids;
  const next = ids.slice();
  next[i] = otherSlot;
  next[j] = fromSlot;
  return next;
}

/** Pane ids whose view changed between two tile lists (replacement or swap). */
export function mosaicPaneIdsWithViewChange(prev: string[], next: string[]): string[] {
  const out = new Set<string>();
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  for (const id of prev) if (!nextSet.has(id)) out.add(id);
  for (const id of next) if (!prevSet.has(id)) out.add(id);
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    if (prev[i] !== next[i]) {
      if (prev[i]) out.add(prev[i]);
      if (next[i]) out.add(next[i]);
    }
  }
  return [...out];
}

/** Set one pane to a view id, allocating a new tile slot when needed. */
export function placePaneTileView(ids: string[], fromSlot: string, viewId: string): string[] {
  const i = ids.indexOf(fromSlot);
  if (i < 0 || !viewId) return ids;
  const next = ids.slice();
  next[i] = allocateMosaicTileSlot(viewId, next.filter((_, j) => j !== i));
  return next;
}

/** @deprecated Use placePaneTileView / movePaneTileView via mosaic view pick helpers. */
export function nextPaneTiles(ids: string[], fromSlot: string, viewId: string): string[] {
  if (!viewId || fromSlot === viewId) return ids;
  const j = ids.findIndex((id, k) => k !== ids.indexOf(fromSlot) && mosaicTileViewId(id) === viewId);
  if (j >= 0) {
    if (viewId.startsWith("plugin:")) return placePaneTileView(ids, fromSlot, viewId);
    return movePaneTileView(ids, fromSlot, ids[j]!);
  }
  return placePaneTileView(ids, fromSlot, viewId);
}

/** Put `want` onto existing cells in order. Extra / missing ids keep the leftover leaves. */
export function assignTiles(n: MosaicNode, want: string[]): MosaicNode {
  const cur = leafIds(n);
  const clean = parseMosaicTiles(want);
  const next = cur.map((id, i) => clean[i] ?? id);
  return mapLeaves(n, next);
}

export function equalize(n: MosaicNode): MosaicNode {
  if (n.type === "leaf") return { type: "leaf", id: n.id };
  return { type: "split", dir: n.dir, ratio: 0.5, a: equalize(n.a), b: equalize(n.b) };
}

export function setRatio(n: MosaicNode, path: string, ratio: number): MosaicNode {
  if (n.type === "leaf" || !path) return n.type === "split" ? { ...n, ratio: clampRatio(ratio) } : cloneNode(n);
  const step = path[0];
  const rest = path.slice(1);
  if (step === "a") return { ...n, a: setRatio(n.a, rest, ratio), dir: n.dir, ratio: n.ratio, type: "split" };
  if (step === "b") return { ...n, b: setRatio(n.b, rest, ratio), dir: n.dir, ratio: n.ratio, type: "split" };
  return { ...n, ratio: clampRatio(ratio) };
}

export function presetCount(size: MosaicSize): number {
  if (size === "off") return 0;
  const n = Number(size);
  return Number.isFinite(n) ? n : 0;
}
