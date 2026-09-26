import { packNavigationStopped } from "./plugin-copy";
import type { MosaicNoticeHost } from "./plugin-pack-feed";

const stoppedTiles = new Set<string>();
const removeHandlers = new Map<string, () => void>();

export function resetPackAssetNavigationState(): void {
  stoppedTiles.clear();
  removeHandlers.clear();
}

export function markPackNavigationStopped(tileId: string): boolean {
  if (stoppedTiles.has(tileId)) return false;
  stoppedTiles.add(tileId);
  return true;
}

export function packNavigationStoppedForTile(tileId: string): boolean {
  return stoppedTiles.has(tileId);
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
