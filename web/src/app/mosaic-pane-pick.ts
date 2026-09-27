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

/** Mosaic chrome pick → `switchPaneView` (consent). Used by `main.ts` and pack-start tests. */
export function mosaicOnPanePickHandler(
  deps: MosaicPanePickDeps,
): MosaicOnPanePick {
  return (fromId, toId) => pickMosaicPaneWith(deps, fromId, toId);
}
