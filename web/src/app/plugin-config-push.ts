/** Push live plugin config to the sandbox when that pack is loaded (config.read). */
export function shouldPushSandboxConfig(loadedPackId: string, packId: string): boolean {
  return !!loadedPackId && loadedPackId === packId;
}
