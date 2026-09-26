/** @deprecated Import from `./pack-consent` — single session map lives there. */
import {
  ensurePackConsent,
  type ConsentReviewResult,
  type PackReviewRunner,
  ensurePackReviewed,
  ensurePackReviewedOutcome,
  isPackConsentPending,
  resetPackConsentForTests,
} from "./pack-consent";

export type { ConsentReviewResult, PackReviewRunner };
export {
  ensurePackConsent,
  ensurePackReviewed,
  ensurePackReviewedOutcome,
  isPackConsentPending,
};
export const resetSharedPackConsentForTests = resetPackConsentForTests;
/** @deprecated Use `ensurePackConsent`. */
export function runSharedPackConsent(
  packId: string,
  review: PackReviewRunner,
  signal: AbortSignal = new AbortController().signal,
): Promise<ConsentReviewResult> {
  return ensurePackConsent(packId, review, signal);
}
