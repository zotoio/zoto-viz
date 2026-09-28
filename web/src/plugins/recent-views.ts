import { mosaicTileViewId } from "../graph/mosaic-tile-id";

/** How many user-picked views stay pinned at the top of every view menu. */
export const RECENT_VIEW_LIMIT = 10;
export const RECENT_VIEW_GROUP = "recent";
const STORE_KEY = "zoto-viz.recentViews";

let recent: string[] = readStore();

export function recentViewIds(): readonly string[] {
  return recent;
}

/** Most recent first, unique catalog ids, capped. */
export function normalizeRecentViews(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = mosaicTileViewId(item.trim());
    if (!id || id.startsWith("__") || out.includes(id)) continue;
    out.push(id);
    if (out.length >= RECENT_VIEW_LIMIT) break;
  }
  return out;
}

/** Replace the pin list (profile restore). Does not count as a new user pick. */
export function setRecentViews(raw: unknown): void {
  recent = normalizeRecentViews(raw);
  writeStore();
}

/**
 * User chose this view from a menu, digit key, or mosaic pane.
 * Returns true when the pin list changed.
 */
export function noteUserView(id: string): boolean {
  const view = mosaicTileViewId(id.trim());
  if (!view || view.startsWith("__")) return false;
  const next = normalizeRecentViews([view, ...recent]);
  if (next.length === recent.length && next.every((v, i) => v === recent[i])) return false;
  recent = next;
  writeStore();
  return true;
}

function readStore(): string[] {
  try {
    return normalizeRecentViews(JSON.parse(localStorage.getItem(STORE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeStore(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(recent)); } catch { /* private mode */ }
}

export function resetRecentViewsForTests(): void {
  recent = [];
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}
