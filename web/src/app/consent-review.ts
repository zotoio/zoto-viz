/** @deprecated Import from `./pack-consent` — single session map lives there. */
import {
  ensurePackConsent,
  type ConsentReviewResult,
  type PackReviewRunner,
  abortAllOpenPackConsents,
  ensurePackReviewed,
  ensurePackReviewedOutcome,
  isPackConsentPending,
  resetPackConsentForTests,
} from "./pack-consent";

export type { ConsentReviewResult, PackReviewRunner };
export {
  abortAllOpenPackConsents,
  ensurePackConsent,
  ensurePackReviewed,
  ensurePackReviewedOutcome,
  isPackConsentPending,
};
export const resetSharedPackConsentForTests = resetPackConsentForTests;
/** @deprecated Use `ensurePackConsent`. */
export const runSharedPackConsent = ensurePackConsent;
