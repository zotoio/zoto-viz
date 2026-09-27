/** Consent-pending state kept free of plugin imports so media and camera modules can read it. */

export type ConsentReviewResult = "ok" | "declined" | "failed" | "aborted";

export type PendingEntry = {
  promise: Promise<ConsentReviewResult>;
  signal: AbortSignal;
};

/** Single in-flight consent per pack id (session-scoped). PR #42 lands the same map here. */
export const pendingByPackId = new Map<string, PendingEntry>();

export function isPackConsentPending(packId?: string | null): boolean {
  if (packId) return pendingByPackId.has(packId);
  return pendingByPackId.size > 0;
}

export function resetPackConsentForTests(): void {
  pendingByPackId.clear();
}
