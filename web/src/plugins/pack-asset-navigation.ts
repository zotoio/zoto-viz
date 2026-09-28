import { packNavigationStopped } from "./plugin-copy";
import type { MosaicNoticeHost } from "./plugin-pack-feed";
import { tileDisplayName, type PluginView } from "./plugin";

const stoppedTiles = new Set<string>();
const deferredNavNoticeTimer = new Map<string, ReturnType<typeof setTimeout>>();
const navigationNoticeRetired = new Set<string>();
const removeHandlers = new Map<string, () => void>();

export function resetPackAssetNavigationState(): void {
  for (const timer of deferredNavNoticeTimer.values()) {
    clearTimeout(timer);
  }
  deferredNavNoticeTimer.clear();
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
  const timer = deferredNavNoticeTimer.get(tileId);
  if (timer) {
    clearTimeout(timer);
    deferredNavNoticeTimer.delete(tileId);
  }
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

function packViewForTile(tileId: string, packName: string): PluginView {
  const id = tileId.startsWith("plugin:") ? tileId.slice("plugin:".length) : tileId;
  return { id, name: packName, version: 1 };
}

export function applyPackNavigationStoppedNotice(
  mosaic: MosaicNoticeHost | null | undefined,
  tileId: string,
  packName: string,
): void {
  if (!mosaic || !packNavigationStoppedForTile(tileId)) return;
  if (deferredNavNoticeTimer.has(tileId)) return;
  const timer = setTimeout(() => {
    deferredNavNoticeTimer.delete(tileId);
    const label = tileDisplayName(packViewForTile(tileId, packName));
    mosaic.setPaneNotice(tileId, packNavigationStoppedNotice(label), "fail", {
      showRemoveFromWall: true,
      onRemoveFromWall: () => { invokePackNavigationRemove(tileId); },
    });
  }, 0);
  deferredNavNoticeTimer.set(tileId, timer);
}
