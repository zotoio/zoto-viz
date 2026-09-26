import type { PluginSandbox } from "../plugins/host";
import {
  presentDriveBindingForPlugin,
  type PresentDriveBinding,
} from "../plugins/viz-present-tick";
import type { PluginView } from "../plugins/plugin";

/** Active pack spec + sandbox present binding (updated on mode commit / rollback). */
export let activePluginSpec: PluginView | null = null;
export let presentDrive: PresentDriveBinding | null = null;

export function getPresentDriveTileId(): string {
  return presentDrive?.tileId ?? "";
}

export type PresentDriveDeps = {
  sandbox: PluginSandbox;
  pluginClock: () => number;
  stageAspect: () => number;
};

export function refreshPluginDriveState(
  spec: PluginView | null,
  _modeId: string,
  deps: PresentDriveDeps,
): void {
  activePluginSpec = spec;
  presentDrive = presentDriveBindingForPlugin(
    deps.sandbox,
    spec,
    deps.pluginClock,
    deps.stageAspect,
  );
}

/** Capture present-drive rollback keys before `liveMode` is updated. */
export function capturePresentDriveBeforeLiveModeCommit(liveMode: string): {
  prevPresentSpec: PluginView | null;
  prevPresentMode: string;
} {
  return { prevPresentSpec: activePluginSpec, prevPresentMode: liveMode };
}

/**
 * `prevPresentMode` must be the **prior** catalog mode id (before `liveMode = nextModeId`).
 * Used by `applyMode` consent decline and mosaic `setPaneView` failure rollback.
 */
export function restorePresentDriveAfterModeRollback(
  prevPresentSpec: PluginView | null,
  prevPresentMode: string,
  fallbackModeId: string,
  specForMode: (modeId: string) => PluginView | null,
  deps: PresentDriveDeps,
): void {
  const modeId = prevPresentMode || fallbackModeId;
  const spec = (prevPresentMode ? specForMode(prevPresentMode) : null) ?? prevPresentSpec;
  refreshPluginDriveState(spec, modeId, deps);
}
