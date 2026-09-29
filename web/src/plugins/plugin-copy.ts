/** User-facing copy for plugin sandbox / pack-asset recovery. */

export function packReconnecting(packName: string): string {
  const name = packName.trim() || "Pack";
  return `Reconnecting ${name}…`;
}

/** A pack whose frame is ready and drawing, but whose tile samples blank. */
export function liveBlankNoticeText(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} is running but not showing anything.`;
}

/** A view's own sky did not arrive before the Starting deadline. */
export function packSkyTimedOut(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} couldn't start.`;
}

export function packSandboxStartFailed(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} couldn't start, its sandbox didn't respond`;
}

export function packNavigationStopped(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} was stopped because it tried to open another page.`;
}

export const SERVER_RESTART_WALL_NOTICE = "The server restarted, so packs were reloaded.";
