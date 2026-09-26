import type { PluginView } from "../plugins/plugin";
import { pluginNeedsReview } from "../plugins/plugin";

export type ConsentReviewResult = "ok" | "declined" | "failed" | "aborted";

type PendingEntry = {
  promise: Promise<ConsentReviewResult>;
  abort: () => void;
};

/** Single in-flight consent per pack id (session-scoped). PR #42 lands the same map here. */
const pendingByPackId = new Map<string, PendingEntry>();

export function isPackConsentPending(packId?: string | null): boolean {
  if (packId) return pendingByPackId.has(packId);
  return pendingByPackId.size > 0;
}

/** Abort every open consent (user mode switch). Resolves waiters with `aborted`. */
export function abortAllOpenPackConsents(): void {
  for (const entry of pendingByPackId.values()) entry.abort();
  pendingByPackId.clear();
}

export function resetPackConsentForTests(): void {
  abortAllOpenPackConsents();
}

/**
 * One in-flight review per pack id (A→B→A→B shares the same prompt while pending).
 * Clears the slot when settled or aborted so a later visit starts fresh.
 */
export async function ensurePackConsent(
  packId: string | null | undefined,
  review: () => Promise<ConsentReviewResult>,
): Promise<ConsentReviewResult> {
  if (!packId) return review();
  const existing = pendingByPackId.get(packId);
  if (existing) return existing.promise;

  let settle!: (r: ConsentReviewResult) => void;
  const promise = new Promise<ConsentReviewResult>((resolve) => { settle = resolve; });
  let done = false;
  const finish = (r: ConsentReviewResult) => {
    if (done) return;
    done = true;
    settle(r);
  };
  const abort = () => finish("aborted");

  const entry: PendingEntry = { promise, abort };
  pendingByPackId.set(packId, entry);

  void review()
    .then((r) => finish(r))
    .catch(() => finish("failed"))
    .finally(() => {
      if (pendingByPackId.get(packId) === entry) pendingByPackId.delete(packId);
    });

  return promise;
}

export type PackReviewRunner = () => Promise<ConsentReviewResult>;

/**
 * Full tri-state outcome for mode switch / rollback (#37).
 * PR #42 adds `ensurePackReviewed(spec): Promise<boolean>` with server grant inlined here;
 * until then the host passes the review runner from `main.ts`.
 */
export async function ensurePackReviewedOutcome(
  spec: PluginView | null,
  review: PackReviewRunner,
): Promise<ConsentReviewResult> {
  if (!spec || !pluginNeedsReview(spec)) return "ok";
  if (spec.consent) return "ok";
  return ensurePackConsent(spec.id, review);
}

/**
 * PR #42 contract (`1f8f785`): server-checked grant, one pending promise per pack id.
 * After #42 merges, move autoconsent / `askPluginReview` / `grantPluginConsent` into this
 * function and delete the `review` parameter from `ensurePackReviewedOutcome`.
 */
export async function ensurePackReviewed(
  spec: PluginView | null,
  review: PackReviewRunner,
): Promise<boolean> {
  const outcome = await ensurePackReviewedOutcome(spec, review);
  return outcome === "ok";
}
