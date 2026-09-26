/** Mosaic tile picks blocked on plugin consent — retried when the catalog shows approval. */

export type ConsentPendingPane = {
  paneId: string;
  toViewId: string;
  fromViewId?: string;
  pluginId: string;
};

const pendingByPane = new Map<string, ConsentPendingPane>();

export function registerConsentPending(entry: ConsentPendingPane): void {
  pendingByPane.set(entry.paneId, entry);
}

export function clearConsentPendingForPane(paneId: string): void {
  pendingByPane.delete(paneId);
}

export function clearAllConsentPending(): void {
  pendingByPane.clear();
}

export function hasConsentPending(): boolean {
  return pendingByPane.size > 0;
}

export function listConsentPending(): ConsentPendingPane[] {
  return [...pendingByPane.values()];
}
