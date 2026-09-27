/**
 * One page-level consent/catalog subscription: a single shared fallback poll while
 * any mosaic tile waits on approval. Primary path is monitor WebSocket `live.patch`
 * (`pluginConsent` / `reloadPlugins`) handled in `applyAgentPatch`.
 */

import { hasConsentPending } from "./consent-pending-panes";

export type PluginConsentSyncHost = {
  refreshCatalogAndResume: () => Promise<void>;
  /** Shared fallback interval while tiles wait (ms). */
  pollIntervalMs?: number;
};

let host: PluginConsentSyncHost | null = null;
let fallbackPollId = 0;

export function initPluginConsentSync(next: PluginConsentSyncHost): void {
  host = next;
}

export function pluginConsentLivePatchNeedsRefresh(patch: Record<string, unknown> | undefined): boolean {
  if (!patch) return false;
  if (patch.reloadPlugins === true) return true;
  const pc = patch.pluginConsent;
  return !!pc && typeof pc === "object" && typeof (pc as { id?: unknown }).id === "string";
}

export function armPluginConsentFallbackPoll(): void {
  if (!host || !hasConsentPending() || fallbackPollId) return;
  const ms = host.pollIntervalMs ?? 10_000;
  fallbackPollId = window.setInterval(() => {
    if (!host || !hasConsentPending()) {
      disarmPluginConsentFallbackPoll();
      return;
    }
    void host.refreshCatalogAndResume();
  }, ms);
}

export function disarmPluginConsentFallbackPoll(): void {
  if (!fallbackPollId) return;
  window.clearInterval(fallbackPollId);
  fallbackPollId = 0;
}

/** Call when pending pane set changes (register / clear). */
export function syncPluginConsentPendingState(): void {
  if (hasConsentPending()) armPluginConsentFallbackPoll();
  else disarmPluginConsentFallbackPoll();
}

export function resetPluginConsentSyncForTests(): void {
  disarmPluginConsentFallbackPoll();
  host = null;
}

export function pluginConsentFallbackPollActive(): boolean {
  return fallbackPollId !== 0;
}
