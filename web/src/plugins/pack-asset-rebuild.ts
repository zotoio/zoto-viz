import { PackAssetTokenInvalidError } from "../core/http";
import type { MosaicNoticeHost } from "./plugin-pack-feed";

type WallNoticeHost = { setWallNotice?: (text: string | null | undefined) => void; focusPaneTile?: (id: string) => void };
import {
  abortPackAssetRebuildForTile,
  activePackForTile,
  beginActivePackLoad,
  beginTileRebuild,
  clearPackAssetRebuildAbort,
  consumeServerRestartWallNotice,
  endActivePackLoad,
  endTileRebuild,
  isActivePackLoad,
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
import { packNavigationStoppedForTile } from "./pack-asset-navigation";
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

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export async function retryPackAssetProtectedLoad(
  tileId: string,
  packName: string,
  mosaic: (MosaicNoticeHost & WallNoticeHost) | null | undefined,
  load: () => Promise<void>,
  opts?: { serverRestart?: boolean },
): Promise<void> {
  resetTileRebuildAttempts(tileId, packName);
  markTileReconnecting(tileId, packName);
  applyPackFeedPaneNotice(mosaic, tileId, packName);
  mosaic?.focusPaneTile?.(tileId);
  await runPackAssetProtectedLoad(tileId, packName, mosaic, load, opts);
}

export async function runPackAssetProtectedLoad(
  tileId: string,
  packName: string,
  mosaic: (MosaicNoticeHost & WallNoticeHost) | null | undefined,
  load: () => Promise<void>,
  opts?: { serverRestart?: boolean },
): Promise<void> {
  const prevPack = activePackForTile(tileId);
  beginActivePackLoad(tileId, packName);
  if (prevPack && prevPack !== packName && mosaic?.setPaneNotice) {
    mosaic.setPaneNotice(tileId, null);
  }
  abortPackAssetRebuildForTile(tileId, packName);
  const controller = new AbortController();
  const attemptId = registerPackAssetRebuildAbort(tileId, packName, controller);
  const signal = controller.signal;

  const gatedNotice = () => {
    if (isActivePackLoad(tileId, packName)) applyPackFeedPaneNotice(mosaic, tileId, packName);
  };

  const runOnce = async (): Promise<void> => {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    await load();
    if (signal.aborted || !isActivePackLoad(tileId, packName)) return;
    markTileRebuildIdle(tileId, packName);
    resetTileRebuildAttempts(tileId, packName);
    gatedNotice();
  };

  try {
    await runOnce();
    if (signal.aborted || !isActivePackLoad(tileId, packName)) return;
    clearPackAssetRebuildAbort(tileId, packName, attemptId);
    endActivePackLoad(tileId, packName);
    return;
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    if (packNavigationStoppedForTile(tileId)) return;
    if (!isPackAssetTokenInvalid(err)) {
      if (isActivePackLoad(tileId, packName)) markTileRebuildFailed(tileId, packName);
      throw err;
    }
    if (shouldCapRebuild(tileId, packName) || tileRebuildInFlight(tileId, packName)) {
      if (isActivePackLoad(tileId, packName)) markTileRebuildFailed(tileId, packName);
      gatedNotice();
      throw err;
    }
    if (opts?.serverRestart) scheduleServerRestartWallNotice();
    markTileReconnecting(tileId, packName);
    gatedNotice();
    const wall = consumeServerRestartWallNotice();
    if (wall && mosaic?.setWallNotice) mosaic.setWallNotice(wall);

    let lastErr: unknown = err;
    while (!shouldCapRebuild(tileId, packName)) {
      if (signal.aborted || !isActivePackLoad(tileId, packName)) return;
      const attempt = beginTileRebuild(tileId, packName);
      const delay = rebuildBackoffMs(attempt);
      if (delay > 0) {
        try {
          await rebuildSleepImpl(delay, signal);
        } catch (sleepErr) {
          if (isAbort(sleepErr) || !isActivePackLoad(tileId, packName)) return;
          throw sleepErr;
        }
      }
      if (!isActivePackLoad(tileId, packName)) return;
      try {
        await load();
        if (signal.aborted || !isActivePackLoad(tileId, packName)) return;
        markTileRebuildIdle(tileId, packName);
        resetTileRebuildAttempts(tileId, packName);
        gatedNotice();
        endTileRebuild(tileId, packName);
        clearPackAssetRebuildAbort(tileId, packName, attemptId);
        endActivePackLoad(tileId, packName);
        return;
      } catch (retryErr) {
        lastErr = retryErr;
        endTileRebuild(tileId, packName);
        if (isAbort(retryErr) || signal.aborted || !isActivePackLoad(tileId, packName)) return;
        if (!isPackAssetTokenInvalid(retryErr)) {
          markTileRebuildFailed(tileId, packName);
          gatedNotice();
          throw retryErr;
        }
        markTileReconnecting(tileId, packName);
        gatedNotice();
      }
    }
    if (isActivePackLoad(tileId, packName)) {
      markTileRebuildFailed(tileId, packName);
      gatedNotice();
    }
    throw lastErr;
  }
}
