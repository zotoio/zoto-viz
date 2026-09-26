import {
  mintPackAssetToken,
  PackAssetForbiddenError,
  registerPackAssetFrame,
  unregisterPackAssetFrame,
} from "../core/http";
import { packReconnecting, packSandboxStartFailed, SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";

const tileFrames = new Map<string, string>();
let wallNoticePending = false;
let wallNoticeShown = false;

export type RebuildPhase = "idle" | "reconnecting" | "failed";

export type TileRebuildState = {
  phase: RebuildPhase;
  failedOnce: boolean;
  keepVisible: boolean;
};

const tileRebuild = new Map<string, TileRebuildState>();

export function resetPackAssetFrameState(): void {
  tileFrames.clear();
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

export async function openPackAssetFrame(tileId: string): Promise<string> {
  const frameId = crypto.randomUUID();
  await registerPackAssetFrame(frameId);
  notePackAssetFrameForTile(tileId, frameId);
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

export function shouldCapRebuild(tileId: string): boolean {
  return tileRebuildState(tileId).failedOnce;
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
