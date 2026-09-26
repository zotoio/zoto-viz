import { PackAssetForbiddenError } from "../core/http";
import type { Mosaic } from "../graph/mosaic";
import {
  consumeServerRestartWallNotice,
  markTileRebuildFailed,
  markTileRebuildIdle,
  markTileReconnecting,
  scheduleServerRestartWallNotice,
  shouldCapRebuild,
} from "./pack-asset-frame";
import { applyPackFeedPaneNotice } from "./plugin-pack-feed";

export function isPackAsset403(err: unknown): boolean {
  if (err instanceof PackAssetForbiddenError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b403\b/.test(msg) && msg.includes("/pack-assets/");
}

export async function runPackAssetProtectedLoad(
  tileId: string,
  packName: string,
  mosaic: Mosaic | null | undefined,
  load: () => Promise<void>,
  opts?: { serverRestart?: boolean },
): Promise<void> {
  const attempt = async (): Promise<void> => {
    await load();
    markTileRebuildIdle(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
  };
  try {
    await attempt();
    return;
  } catch (err) {
    if (!isPackAsset403(err) || shouldCapRebuild(tileId)) {
      markTileRebuildFailed(tileId);
      throw err;
    }
    if (opts?.serverRestart) scheduleServerRestartWallNotice();
    markTileReconnecting(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
    const wall = consumeServerRestartWallNotice();
    if (wall && mosaic) mosaic.setWallNotice(wall);
    try {
      await attempt();
    } catch (retryErr) {
      markTileRebuildFailed(tileId);
      applyPackFeedPaneNotice(mosaic, tileId, packName);
      throw retryErr;
    }
  }
}
