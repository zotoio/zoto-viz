import {
  mintPackAssetToken,
  PackAssetForbiddenError,
  registerPackAssetFrame,
  unregisterPackAssetFrame,
} from "../core/http";
import { packReconnecting, packSandboxStartFailed, SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";

const tileFrames = new Map<string, string>();
const tileFrameOpenCounts = new Map<string, number>();
const tileRebuildAttempts = new Map<string, number>();
const tileRebuildInflight = new Set<string>();
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
const retryHandlers = new Map<string, { packName: string; run: () => void }>();

export function resetPackAssetFrameState(): void {
  tileFrames.clear();
  tileFrameOpenCounts.clear();
  tileRebuildAttempts.clear();
  tileRebuildInflight.clear();
  tileRebuild.clear();
  wallNoticePending = false;
  wallNoticeShown = false;
  retryHandlers.clear();
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

export async function closePackAssetFrameForTile(tileId: string): Promise<void> {
  const frameId = tileFrames.get(tileId);
  if (!frameId) return;
  tileFrames.delete(tileId);
  await unregisterPackAssetFrame(frameId);
}

export function tileRebuildState(tileId: string): TileRebuildState {
  let row = tileRebuild.get(tileId);
  if (!row) {
    row = { phase: "idle", failedOnce: false, keepVisible: true };
    tileRebuild.set(tileId, row);
  }
  return row;
}

export function markTileReconnecting(tileId: string): void {
  const row = tileRebuildState(tileId);
  row.phase = "reconnecting";
  row.keepVisible = true;
}

export function markTileRebuildFailed(tileId: string): void {
  const row = tileRebuildState(tileId);
  row.phase = "failed";
  row.failedOnce = true;
  row.keepVisible = true;
}

export function markTileRebuildIdle(tileId: string): void {
  const row = tileRebuildState(tileId);
  row.phase = "idle";
}

export function tileReconnectingNotice(packName: string): string {
  return packReconnecting(packName);
}

export function tileRebuildFailedNotice(packName: string): string {
  return packSandboxStartFailed(packName);
}

export function tileRebuildAttemptCount(tileId: string): number {
  return tileRebuildAttempts.get(tileId) ?? 0;
}

export function resetTileRebuildAttempts(tileId: string): void {
  tileRebuildAttempts.delete(tileId);
}

export function rebuildBackoffMs(attemptIndex: number): number {
  return REBUILD_BACKOFF_MS[Math.min(attemptIndex - 1, REBUILD_BACKOFF_MS.length - 1)] ?? 0;
}

/** Returns 1-based attempt number for this rebuild cycle (caps at {@link MAX_REBUILD_ATTEMPTS}). */
export function beginTileRebuild(tileId: string): number {
  tileRebuildInflight.add(tileId);
  const next = Math.min((tileRebuildAttempts.get(tileId) ?? 0) + 1, MAX_REBUILD_ATTEMPTS);
  tileRebuildAttempts.set(tileId, next);
  return next;
}

export function endTileRebuild(tileId: string): void {
  tileRebuildInflight.delete(tileId);
}

export function tileRebuildInFlight(tileId: string): boolean {
  return tileRebuildInflight.has(tileId);
}

export function shouldCapRebuild(tileId: string): boolean {
  return (tileRebuildAttempts.get(tileId) ?? 0) >= MAX_REBUILD_ATTEMPTS;
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
