import type { PluginView } from "../plugins/plugin";
import { pluginNeedsReview } from "../plugins/plugin";
import { consentGranted } from "./consent-store";

/** True when the pack ships code and the consent store has no grant for its current content. */
export function packNeedsConsent(spec: PluginView | null | undefined): boolean {
  return !!spec && pluginNeedsReview(spec) && !consentGranted(spec);
}

/** No review modal until the catalog has loaded consent from the monitor. */
export function shouldPromptPluginReview(
  spec: PluginView | null,
  catalogReady: boolean,
): boolean {
  if (!spec || !pluginNeedsReview(spec)) return false;
  if (!catalogReady) return false;
  if (consentGranted(spec)) return false;
  return true;
}
