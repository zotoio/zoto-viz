import type { SwitchPaneViewResult } from "./switch-pane-view";

/** Header mode dropdown on a mosaic wall — must go through `runMosaicPaneSwitch` (consent in `switchPaneView`). */
export async function mosaicHeaderModePick(
  modeId: string,
  deps: {
    mosaicOn: boolean;
    runMosaicPaneSwitch: (toViewId: string) => Promise<SwitchPaneViewResult>;
  },
): Promise<SwitchPaneViewResult | null> {
  if (!deps.mosaicOn) return null;
  return deps.runMosaicPaneSwitch(modeId);
}
