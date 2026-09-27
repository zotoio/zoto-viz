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
