/** One committed view id after reload — session snapshot wins over bare localStorage. */
export function resolveRestoredViewMode(args: {
  sessionMode?: string;
  localMode?: string | null;
  fallback: string;
}): string {
  const fromSession = args.sessionMode?.trim();
  if (fromSession) return fromSession;
  const fromLocal = args.localMode?.trim();
  if (fromLocal) return fromLocal;
  return args.fallback;
}

/** Header selector, main graph mode, and mounted plugin id should agree. */
export function viewMountState(args: {
  headerModeId: string;
  sceneModeId: string;
  pluginActiveId: string | null;
}): boolean {
  if (args.headerModeId !== args.sceneModeId) return false;
  const pluginId = args.headerModeId.startsWith("plugin:")
    ? args.headerModeId.slice("plugin:".length)
    : null;
  if (pluginId && args.pluginActiveId && args.pluginActiveId !== pluginId) return false;
  return true;
}
