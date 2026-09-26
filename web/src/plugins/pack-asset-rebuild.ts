import { PackAssetTokenInvalidError } from "../core/http";
import type { MosaicNoticeHost } from "./plugin-pack-feed";

type WallNoticeHost = { setWallNotice?: (text: string | null | undefined) => void };
import {
  abortPackAssetRebuildForTile,
  beginTileRebuild,
  clearPackAssetRebuildAbort,
  consumeServerRestartWallNotice,
  endTileRebuild,
  markTileRebuildFailed,
  markTileRebuildIdle,
  markTileReconnecting,
  registerPackAssetRebuildAbort,
  rebuildBackoffMs,
  resetTileRebuildAttempts,
  scheduleServerRestartWallNotice,
  shouldCapRebuild,
  tileRebuildInFlight,
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

let rebuildSleepImpl: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(new DOMException("aborted", "AbortError"));
    return;
  }
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new DOMException("aborted", "AbortError"));
  }, { once: true });
});

export function setRebuildSleepForTests(
  fn: (ms: number, signal: AbortSignal) => Promise<void>,
): void {
  rebuildSleepImpl = fn;
}

export function resetRebuildSleepForTests(): void {
  rebuildSleepImpl = (ms, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

export async function runPackAssetProtectedLoad(
  tileId: string,
  packName: string,
  mosaic: (MosaicNoticeHost & WallNoticeHost) | null | undefined,
  load: () => Promise<void>,
  opts?: { serverRestart?: boolean },
): Promise<void> {
  abortPackAssetRebuildForTile(tileId, packName);
  const controller = new AbortController();
  registerPackAssetRebuildAbort(tileId, packName, controller);
  const signal = controller.signal;

  const runOnce = async (): Promise<void> => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    await load();
    markTileRebuildIdle(tileId);
    resetTileRebuildAttempts(tileId, packName);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
  };

  try {
    await runOnce();
    clearPackAssetRebuildAbort(tileId, packName);
    return;
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw err;
    }
    if (!isPackAssetTokenInvalid(err)) {
      markTileRebuildFailed(tileId);
      throw err;
    }
    if (shouldCapRebuild(tileId, packName) || tileRebuildInFlight(tileId, packName)) {
      markTileRebuildFailed(tileId);
      applyPackFeedPaneNotice(mosaic, tileId, packName);
      throw err;
    }
    if (opts?.serverRestart) scheduleServerRestartWallNotice();
    markTileReconnecting(tileId);
    applyPackFeedPaneNotice(mosaic, tileId, packName);
    const wall = consumeServerRestartWallNotice();
    if (wall && mosaic?.setWallNotice) mosaic.setWallNotice(wall);

    let lastErr: unknown = err;
    while (!shouldCapRebuild(tileId, packName)) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const attempt = beginTileRebuild(tileId, packName);
      const delay = rebuildBackoffMs(attempt);
      if (delay > 0) await rebuildSleepImpl(delay, signal);
      try {
        await load();
        markTileRebuildIdle(tileId);
        resetTileRebuildAttempts(tileId, packName);
        applyPackFeedPaneNotice(mosaic, tileId, packName);
        endTileRebuild(tileId, packName);
        clearPackAssetRebuildAbort(tileId, packName);
        return;
      } catch (retryErr) {
        lastErr = retryErr;
        endTileRebuild(tileId, packName);
        if (signal.aborted || (retryErr instanceof DOMException && retryErr.name === "AbortError")) {
          throw retryErr;
        }
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
