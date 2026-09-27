/** Whether live iframe config.push is allowed for a settings store id. */
export function sandboxConfigPushAllowed(loadedConfigStoreId: string | null, editStoreId: string): boolean {
  if (!loadedConfigStoreId) return false;
  return loadedConfigStoreId === editStoreId;
}
