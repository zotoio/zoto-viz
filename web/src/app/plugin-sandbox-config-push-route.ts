import {
  allowOnPluginChangeConfigPush,
  allowOnPluginFieldsConfigPush,
} from "../plugins/plugin-config-sync";
import { configStoreId, type PluginView } from "../plugins/plugin";

/** Loaded iframe config store id when the pack exposes config.read (main.ts tsWatchStoreId gate). */
export function sandboxLoadedConfigStoreId(
  tsWatchStoreId: string,
  loadedSpec: PluginView | null,
): string | null {
  if (!tsWatchStoreId) return null;
  if (!loadedSpec?.capabilities?.includes("config.read")) return null;
  return tsWatchStoreId;
}

export function mayPushSandboxOnPluginChange(
  loadedStoreId: string | null,
  editStoreId: string,
  editSpec: PluginView | null,
): boolean {
  return allowOnPluginChangeConfigPush(
    loadedStoreId,
    editStoreId,
    editSpec?.capabilities?.includes("config.read") ?? false,
  );
}

export function mayPushSandboxOnPluginFields(
  loadedStoreId: string | null,
  fieldsSpec: PluginView,
): boolean {
  return allowOnPluginFieldsConfigPush(
    loadedStoreId,
    configStoreId(fieldsSpec),
    fieldsSpec.capabilities?.includes("config.read") ?? false,
  );
}

export type PendingSandboxConfigPush = { storeId: string; config: Record<string, string> };

/** main.ts maybePushSandboxForStore — schedule or defer until the matching store loads. */
export function routePluginChangeSandboxPush(
  loadedStoreId: string | null,
  editStoreId: string,
  editSpec: PluginView | null,
  config: Record<string, string>,
  schedule: (storeId: string, config: Record<string, string>) => void,
): PendingSandboxConfigPush | null {
  if (!editSpec || !mayPushSandboxOnPluginChange(loadedStoreId, editStoreId, editSpec)) {
    return null;
  }
  if (loadedStoreId === editStoreId) {
    schedule(editStoreId, config);
    return null;
  }
  return { storeId: editStoreId, config };
}
