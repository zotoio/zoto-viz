import { PackAssetTokenInvalidError } from "../core/http";
import type { Mosaic } from "../graph/mosaic";
import {
  consumeServerRestartWallNotice,
  markTileRebuildFailed,
  markTileRebuildIdle,
  markTileReconnecting,
  rebuildBackoffMs,
  resetTileRebuildAttempts,
  scheduleServerRestartWallNotice,
  shouldCapRebuild,
  tileRebuildInFlight,
  beginTileRebuild,
  endTileRebuild,
} from "./pack-asset-frame";
import { applyPackFeedPaneNotice } from "./plugin-pack-feed";

export function isPackAssetTokenInvalid(err: unknown): boolean {
  if (err instanceof PackAssetTokenInvalidError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b401\b/.test(msg) && msg.includes("token_invalid");
}

/** @deprecated use {@link isPackAssetTokenInvalid} */
export function isPackAsset403(err: unknown): boolean {
  return isPackAssetTokenInvalid(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runPackAssetProtectedLoad(
  tileId: string,
  packName: string,
  mosaic: Mosaic | null | undefined,
  load: () => Promise<void>,
  opts?: { serverRestart?: boolean },
): Promise<void> {
  const runOnce = async (): Promise<void> => {
    await load();
    markTileRebuildIdle(tileId);
    resetTileRebuildAttempts(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
  };

  try {
    await runOnce();
    return;
  } catch (err) {
    if (!isPackAssetTokenInvalid(err)) {
      markTileRebuildFailed(tileId);
      throw err;
    }
    if (shouldCapRebuild(tileId) || tileRebuildInFlight(tileId)) {
      markTileRebuildFailed(tileId);
      applyPackFeedPaneNotice(mosaic, tileId, packName);
      throw err;
    }
    if (opts?.serverRestart) scheduleServerRestartWallNotice();
    markTileReconnecting(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
    const wall = consumeServerRestartWallNotice();
    if (wall && mosaic) mosaic.setWallNotice(wall);

    let lastErr: unknown = err;
    while (!shouldCapRebuild(tileId)) {
      const attempt = beginTileRebuild(tileId);
      const delay = rebuildBackoffMs(attempt);
      if (delay > 0) await sleep(delay);
      try {
        await load();
        markTileRebuildIdle(tileId);
        resetTileRebuildAttempts(tileId);
        applyPackFeedPaneNotice(mosaic, tileId, packName);
        endTileRebuild(tileId);
        return;
      } catch (retryErr) {
        lastErr = retryErr;
        endTileRebuild(tileId);
        if (!isPackAssetTokenInvalid(retryErr)) {
          markTileRebuildFailed(tileId);
          applyPackFeedPaneNotice(mosaic, tileId, packName);
          throw retryErr;
        }
        markTileReconnecting(tileId);
        applyPackFeedPaneNotice(mosaic, tileId, packName);
      }
    }
    markTileRebuildFailed(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
    throw lastErr;
  }
}
