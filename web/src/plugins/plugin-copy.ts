/** User-facing copy for plugin sandbox / pack-asset recovery. */

export function packReconnecting(packName: string): string {
  const name = packName.trim() || "Pack";
  return `Reconnecting ${name}…`;
}

export function packSandboxStartFailed(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} couldn't start, its sandbox didn't respond`;
}

export const SERVER_RESTART_WALL_NOTICE = "The server restarted, so packs were reloaded.";
