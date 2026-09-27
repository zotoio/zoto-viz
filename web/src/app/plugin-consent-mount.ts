import type { PluginView } from "../plugins/plugin";
import { pluginNeedsReview } from "../plugins/plugin";

/** No review modal until the catalog has loaded consent from the monitor. */
export function shouldPromptPluginReview(
  spec: PluginView | null,
  catalogReady: boolean,
): boolean {
  if (!spec || !pluginNeedsReview(spec)) return false;
  if (!catalogReady) return false;
  if (spec.consent) return false;
  return true;
}
