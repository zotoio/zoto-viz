import { inspectPaneStartup, type PaneStartupSnap } from "../graph/pane-health";

/** Matches PR #35 install pipeline user copy (wired after #35 lands). */
export function formatInstallBlockedMessage(blockedVersion: number, runningVersion: number): string {
  return `v${blockedVersion} was blocked; v${runningVersion} is still running`;
}

export type InstallBlockedPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  blockedVersion?: number;
  runningVersion?: number;
};

/** User-visible line from a failed local publish / install API body. */
export function installBlockedUserMessage(payload: InstallBlockedPayload): string | null {
  if (payload.error !== "install_blocked") return null;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (
    typeof payload.blockedVersion === "number"
    && typeof payload.runningVersion === "number"
  ) {
    return formatInstallBlockedMessage(payload.blockedVersion, payload.runningVersion);
  }
  return null;
}

/** True when the tile is bound and pane-health would not fault it (graph draws, sky ok, etc.). */
export function pluginTileDraws(snap: PaneStartupSnap): boolean {
  return snap.bound && snap.kind !== "empty" && inspectPaneStartup(snap) === null;
}
