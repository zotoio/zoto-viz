import type { SwitchPaneViewResult } from "./switch-pane-view";

export type MosaicPanePickDeps = {
  runSwitch: (toViewId: string, fromViewId?: string) => Promise<SwitchPaneViewResult>;
  refreshMosaicSlots: () => void;
};

export async function pickMosaicPaneWith(
  deps: MosaicPanePickDeps,
  fromId: string,
  toId: string,
): Promise<boolean> {
  const sw = await deps.runSwitch(toId, fromId);
  if (!sw.ok) {
    deps.refreshMosaicSlots();
    return false;
  }
  return true;
}

export type MosaicOnPanePick = (
  fromId: string,
  toId: string,
) => boolean | Promise<boolean>;

/** Wire mosaic wall chrome picks through `pickMosaicPaneWith` (PR #103 `onPanePick` hunk). */
export function applyMosaicWallPanePick<T extends { onPanePick?: MosaicOnPanePick }>(
  cfg: T,
  deps: MosaicPanePickDeps,
): T {
  cfg.onPanePick = (fromId, toId) => pickMosaicPaneWith(deps, fromId, toId);
  return cfg;
}
