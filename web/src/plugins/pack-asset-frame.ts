import {
  mintPackAssetToken,
  PackAssetForbiddenError,
  registerPackAssetFrame,
  unregisterPackAssetFrame,
} from "../core/http";
import { clearPackNavigationStopped } from "./pack-asset-navigation";
import { packReconnecting, packSandboxStartFailed, SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";

const tileFrames = new Map<string, string>();
const tileFrameOpenCounts = new Map<string, number>();
const tileRebuildAttempts = new Map<string, number>();
const tileRebuildInflight = new Set<string>();
type RebuildAbortRow = { controller: AbortController; attemptId: number };
const rebuildAbort = new Map<string, RebuildAbortRow>();
let rebuildAttemptSeq = 0;
const retryHandlers = new Map<string, { packName: string; run: () => void }>();
const activePackByTile = new Map<string, string>();
let wallNoticePending = false;
let wallNoticeShown = false;

const REBUILD_BACKOFF_MS = [1000, 2000, 4000];
const MAX_REBUILD_ATTEMPTS = 3;

export type RebuildPhase = "idle" | "reconnecting" | "failed";

export type TileRebuildState = {
  phase: RebuildPhase;
  failedOnce: boolean;
  keepVisible: boolean;
};

const tileRebuild = new Map<string, TileRebuildState>();

export function rebuildAttemptKey(tileId: string, packName: string): string {
  return `${tileId}\x1f${packName}`;
}

export function resetPackAssetFrameState(): void {
  tileFrames.clear();
  tileFrameOpenCounts.clear();
  tileRebuildAttempts.clear();
  tileRebuildInflight.clear();
  rebuildAbort.clear();
  retryHandlers.clear();
  activePackByTile.clear();
  tileRebuild.clear();
  wallNoticePending = false;
  wallNoticeShown = false;
}

export function notePackAssetFrameForTile(tileId: string, frameId: string): void {
  tileFrames.set(tileId, frameId);
}

export function packAssetFrameForTile(tileId: string): string | undefined {
  return tileFrames.get(tileId);
}

export function packAssetFrameOpenCount(tileId: string): number {
  return tileFrameOpenCounts.get(tileId) ?? 0;
}

export async function openPackAssetFrame(tileId: string): Promise<string> {
  const frameId = crypto.randomUUID();
  await registerPackAssetFrame(frameId);
  notePackAssetFrameForTile(tileId, frameId);
  tileFrameOpenCounts.set(tileId, (tileFrameOpenCounts.get(tileId) ?? 0) + 1);
  return frameId;
}

export function abortPackAssetRebuildForTile(tileId: string, packName?: string): void {
  if (packName) {
    rebuildAbort.get(rebuildAttemptKey(tileId, packName))?.controller.abort();
    return;
  }
  for (const key of rebuildAbort.keys()) {
    if (key.startsWith(`${tileId}\x1f`)) rebuildAbort.get(key)?.controller.abort();
  }
}

export function registerPackAssetRebuildAbort(
  tileId: string,
  packName: string,
  controller: AbortController,
): number {
  const key = rebuildAttemptKey(tileId, packName);
  rebuildAbort.get(key)?.controller.abort();
  const attemptId = ++rebuildAttemptSeq;
  rebuildAbort.set(key, { controller, attemptId });
  return attemptId;
}

export function clearPackAssetRebuildAbort(
  tileId: string,
  packName: string,
  attemptId?: number,
): void {
  const key = rebuildAttemptKey(tileId, packName);
  const row = rebuildAbort.get(key);
  if (!row) return;
  if (attemptId !== undefined && row.attemptId !== attemptId) return;
  rebuildAbort.delete(key);
}

export function beginActivePackLoad(tileId: string, packName: string): void {
  const prev = activePackByTile.get(tileId);
  if (prev && prev !== packName) {
    clearPackNavigationStopped(tileId);
    abortPackAssetRebuildForTile(tileId, prev);
    tileRebuild.delete(rebuildAttemptKey(tileId, prev));
  }
  activePackByTile.set(tileId, packName);
}

export function endActivePackLoad(tileId: string, packName: string): void {
  if (activePackByTile.get(tileId) === packName) activePackByTile.delete(tileId);
}

export function isActivePackLoad(tileId: string, packName: string): boolean {
  return activePackByTile.get(tileId) === packName;
}

export function activePackForTile(tileId: string): string | undefined {
  return activePackByTile.get(tileId);
}

export async function closePackAssetFrameForTile(tileId: string): Promise<void> {
  abortPackAssetRebuildForTile(tileId);
  activePackByTile.delete(tileId);
  const frameId = tileFrames.get(tileId);
  if (!frameId) return;
  tileFrames.delete(tileId);
  await unregisterPackAssetFrame(frameId);
}

export function registerPackAssetRetry(tileId: string, packName: string, run: () => void): void {
  retryHandlers.set(tileId, { packName, run });
}

export function invokePackAssetRetry(tileId: string): boolean {
  const row = retryHandlers.get(tileId);
  if (!row) return false;
  row.run();
  return true;
}

export function tileRebuildState(tileId: string, packName: string): TileRebuildState {
  const key = rebuildAttemptKey(tileId, packName);
  let row = tileRebuild.get(key);
  if (!row) {
    row = { phase: "idle", failedOnce: false, keepVisible: true };
    tileRebuild.set(key, row);
  }
  return row;
}

export function markTileReconnecting(tileId: string, packName: string): void {
  const row = tileRebuildState(tileId, packName);
  row.phase = "reconnecting";
  row.keepVisible = true;
}

export function markTileRebuildFailed(tileId: string, packName: string): void {
  const row = tileRebuildState(tileId, packName);
  row.phase = "failed";
  row.failedOnce = true;
  row.keepVisible = true;
}

export function markTileRebuildIdle(tileId: string, packName: string): void {
  const row = tileRebuildState(tileId, packName);
  row.phase = "idle";
  row.failedOnce = false;
}

export function tileReconnectingNotice(packName: string): string {
  return packReconnecting(packName);
}

export function tileRebuildFailedNotice(packName: string): string {
  return packSandboxStartFailed(packName);
}

export function tileRebuildAttemptCount(tileId: string, packName: string): number {
  return tileRebuildAttempts.get(rebuildAttemptKey(tileId, packName)) ?? 0;
}

export function resetTileRebuildAttempts(tileId: string, packName: string): void {
  tileRebuildAttempts.delete(rebuildAttemptKey(tileId, packName));
  const row = tileRebuildState(tileId, packName);
  row.phase = "idle";
  row.failedOnce = false;
}

export function rebuildBackoffMs(attemptIndex: number): number {
  return REBUILD_BACKOFF_MS[Math.min(attemptIndex - 1, REBUILD_BACKOFF_MS.length - 1)] ?? 0;
}

export function beginTileRebuild(tileId: string, packName: string): number {
  const key = rebuildAttemptKey(tileId, packName);
  tileRebuildInflight.add(key);
  const next = Math.min((tileRebuildAttempts.get(key) ?? 0) + 1, MAX_REBUILD_ATTEMPTS);
  tileRebuildAttempts.set(key, next);
  return next;
}

export function endTileRebuild(tileId: string, packName: string): void {
  tileRebuildInflight.delete(rebuildAttemptKey(tileId, packName));
}

export function tileRebuildInFlight(tileId: string, packName: string): boolean {
  return tileRebuildInflight.has(rebuildAttemptKey(tileId, packName));
}

export function shouldCapRebuild(tileId: string, packName: string): boolean {
  return (tileRebuildAttempts.get(rebuildAttemptKey(tileId, packName)) ?? 0) >= MAX_REBUILD_ATTEMPTS;
}

export function scheduleServerRestartWallNotice(): void {
  wallNoticePending = true;
}

export function consumeServerRestartWallNotice(): string | null {
  if (!wallNoticePending || wallNoticeShown) return null;
  wallNoticeShown = true;
  wallNoticePending = false;
  return SERVER_RESTART_WALL_NOTICE;
}

export { PackAssetForbiddenError };

export async function mintTokenForFrame(packId: string, frameId: string): Promise<string> {
  return mintPackAssetToken(packId, frameId);
}
