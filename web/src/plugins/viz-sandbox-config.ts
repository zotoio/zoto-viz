/** True when the active view mode's pack owns the loaded sandbox iframe. */
export function shouldPushSandboxPluginConfig(
  modePluginId: string | undefined,
  loadedSandboxPackId: string,
): boolean {
  return Boolean(modePluginId && loadedSandboxPackId && modePluginId === loadedSandboxPackId);
}
