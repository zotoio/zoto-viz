/** Whether live iframe config.push is allowed for a settings store id. */
export function sandboxConfigPushAllowed(loadedConfigStoreId: string | null, editStoreId: string): boolean {
  if (!loadedConfigStoreId) return false;
  return loadedConfigStoreId === editStoreId;
}

/** main.ts settings.onPluginChange → sandbox.setConfig */
export function allowOnPluginChangeConfigPush(
  loadedConfigStoreId: string | null,
  editStoreId: string,
  hasConfigRead: boolean,
): boolean {
  if (!hasConfigRead) return false;
  return sandboxConfigPushAllowed(loadedConfigStoreId, editStoreId);
}

/** main.ts onPluginFields → sandbox.setConfig */
export function allowOnPluginFieldsConfigPush(
  loadedConfigStoreId: string | null,
  iframeConfigStoreId: string,
  hasConfigRead: boolean,
): boolean {
  if (!hasConfigRead || !loadedConfigStoreId) return false;
  return loadedConfigStoreId === iframeConfigStoreId;
}
