import { packNavigationStopped } from "./plugin-copy";
import type { MosaicNoticeHost } from "./plugin-pack-feed";

const stoppedTiles = new Set<string>();
const navigationNoticeRetired = new Set<string>();
const removeHandlers = new Map<string, () => void>();

export function resetPackAssetNavigationState(): void {
  stoppedTiles.clear();
  navigationNoticeRetired.clear();
  removeHandlers.clear();
}

export function markPackNavigationStopped(tileId: string): boolean {
  if (stoppedTiles.has(tileId)) return false;
  stoppedTiles.add(tileId);
  return true;
}

export function clearPackNavigationStopped(tileId: string): void {
  if (stoppedTiles.has(tileId)) navigationNoticeRetired.add(tileId);
  stoppedTiles.delete(tileId);
  removeHandlers.delete(tileId);
}

/** User-initiated pack load (view pick, re-add after stop, page reload). */
export function beginUserPackLoadSession(tileId: string): void {
  clearPackNavigationStopped(tileId);
}

/** True when a navigation-stopped notice should be cleared from the pane after stop was cleared. */
export function packNavigationNoticeRetired(tileId: string): boolean {
  return navigationNoticeRetired.has(tileId);
}

export function forgetPackNavigationNoticeRetired(tileId: string): void {
  navigationNoticeRetired.delete(tileId);
}

export function packNavigationStoppedForTile(tileId: string): boolean {
  return stoppedTiles.has(tileId);
}

const NAVIGATION_STOPPED_SNIPPET = "tried to open another page";

/** Count visible navigation-stopped pane notices (for regression tests). */
export function countPackNavigationStoppedPaneNotices(root: ParentNode = document): number {
  let n = 0;
  for (const el of root.querySelectorAll(".mosaic-pane-notice-text")) {
    if (el.textContent?.includes(NAVIGATION_STOPPED_SNIPPET)) n += 1;
  }
  return n;
}

export function registerPackNavigationRemove(tileId: string, run: () => void): void {
  removeHandlers.set(tileId, run);
}

export function invokePackNavigationRemove(tileId: string): boolean {
  const fn = removeHandlers.get(tileId);
  if (!fn) return false;
  fn();
  return true;
}

export function packNavigationStoppedNotice(packName: string): string {
  return packNavigationStopped(packName);
}

export function applyPackNavigationStoppedNotice(
  mosaic: MosaicNoticeHost | null | undefined,
  tileId: string,
  packName: string,
): void {
  if (!mosaic || !packNavigationStoppedForTile(tileId)) return;
  mosaic.setPaneNotice(tileId, packNavigationStoppedNotice(packName), "fail", {
    showRemoveFromWall: true,
    onRemoveFromWall: () => { invokePackNavigationRemove(tileId); },
  });
}
