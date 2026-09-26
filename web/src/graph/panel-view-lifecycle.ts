/**
 * Per-mosaic-tile leases for animation and pack delivery. A view switch must
 * release the previous tile's leases before the new view binds — never stack
 * hidden loops or pack handlers.
 */

const rafLeases = new Map<string, symbol>();
const packLeases = new Map<string, symbol>();

export function panelRafCount(panelId: string): number {
  return rafLeases.has(panelId) ? 1 : 0;
}

export function panelPackCount(panelId: string): number {
  return packLeases.has(panelId) ? 1 : 0;
}

/** Claim the single rAF slot for this tile (replaces any stale claim). */
export function claimPanelRaf(panelId: string): () => void {
  const prev = rafLeases.get(panelId);
  if (prev !== undefined) rafLeases.delete(panelId);
  const token = Symbol("panel-raf");
  rafLeases.set(panelId, token);
  return () => {
    if (rafLeases.get(panelId) === token) rafLeases.delete(panelId);
  };
}

/** Claim the single pack subscription slot for this tile. */
export function claimPanelPack(panelId: string): () => void {
  const prev = packLeases.get(panelId);
  if (prev !== undefined) packLeases.delete(panelId);
  const token = Symbol("panel-pack");
  packLeases.set(panelId, token);
  return () => {
    if (packLeases.get(panelId) === token) packLeases.delete(panelId);
  };
}

/** Drop every lease for a tile (pane close or view id retired). */
export function releasePanelView(panelId: string): void {
  rafLeases.delete(panelId);
  packLeases.delete(panelId);
  if (packSubKey.startsWith(`${panelId}\0`)) {
    packSubRelease?.();
    packSubRelease = null;
    packSubKey = "";
  }
}

export function resetPanelViewLifecycle(): void {
  rafLeases.clear();
  packLeases.clear();
  packSubKey = "";
  packSubRelease?.();
  packSubRelease = null;
}

let packSubKey = "";
let packSubRelease: (() => void) | null = null;

/** Bind at most one pack frame delivery lease per tile (mirrors main feed path). */
export function syncPanelPackSub(panelId: string, packActive: boolean): void {
  const key = `${panelId}\0${packActive ? "1" : "0"}`;
  if (key === packSubKey) return;
  packSubKey = key;
  packSubRelease?.();
  packSubRelease = null;
  if (packActive) packSubRelease = claimPanelPack(panelId);
}
