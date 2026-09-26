import type { SwitchPaneViewResult } from "./switch-pane-view";
import {
  clearConsentPendingForPane,
  listConsentPending,
  type ConsentPendingPane,
} from "./consent-pending-panes";

export type ConsentResumeRunner = (pending: ConsentPendingPane) => Promise<SwitchPaneViewResult>;

/** Re-run `switchPaneView` for tiles waiting on external consent once the catalog shows approval. */
export async function resumePendingConsentPaneSwitches(
  isConsented: (pluginId: string) => boolean,
  runSwitch: ConsentResumeRunner,
): Promise<void> {
  for (const pending of listConsentPending()) {
    if (!isConsented(pending.pluginId)) continue;
    const result = await runSwitch(pending);
    if (result.ok) clearConsentPendingForPane(pending.paneId);
  }
}
