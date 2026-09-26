import type { PluginView } from "../plugins/plugin";
import { pluginNeedsReview } from "../plugins/plugin";

export type ConsentReviewResult = "ok" | "declined" | "failed" | "aborted";

type PendingEntry = {
  promise: Promise<ConsentReviewResult>;
  signal: AbortSignal;
};

/** Single in-flight consent per pack id (session-scoped). PR #42 lands the same map here. */
const pendingByPackId = new Map<string, PendingEntry>();

export function isPackConsentPending(packId?: string | null): boolean {
  if (packId) return pendingByPackId.has(packId);
  return pendingByPackId.size > 0;
}

export function resetPackConsentForTests(): void {
  pendingByPackId.clear();
}

/**
 * One in-flight review per pack id (A→B→A→B shares the same prompt while pending).
 * Clears the slot when settled or aborted so a later visit starts fresh.
 */
export async function ensurePackConsent(
  packId: string | null | undefined,
  review: PackReviewRunner,
  signal: AbortSignal,
): Promise<ConsentReviewResult> {
  if (signal.aborted) return "aborted";
  if (!packId) return review(signal);
  const existing = pendingByPackId.get(packId);
  if (existing && existing.signal === signal) return existing.promise;

  let settle!: (r: ConsentReviewResult) => void;
  const promise = new Promise<ConsentReviewResult>((resolve) => { settle = resolve; });
  let done = false;
  const entry: PendingEntry = { promise, signal };

  const finish = (r: ConsentReviewResult) => {
    if (done) return;
    done = true;
    settle(signal.aborted ? "aborted" : r);
    if (pendingByPackId.get(packId) === entry) pendingByPackId.delete(packId);
  };

  pendingByPackId.set(packId, entry);

  const onAbort = () => finish("aborted");
  signal.addEventListener("abort", onAbort, { once: true });

  void review(signal)
    .then((r) => finish(r))
    .catch(() => finish(signal.aborted ? "aborted" : "failed"))
    .finally(() => {
      signal.removeEventListener("abort", onAbort);
      if (pendingByPackId.get(packId) === entry) pendingByPackId.delete(packId);
    });

  return promise;
}

export type PackReviewRunner = (signal: AbortSignal) => Promise<ConsentReviewResult>;

/**
 * Full tri-state outcome for mode switch / rollback (#37).
 * PR #42: `ensurePackReviewed(spec, review?, signal?)` — optional attempt signal on rebase.
 */
export async function ensurePackReviewedOutcome(
  spec: PluginView | null,
  review: PackReviewRunner,
  signal: AbortSignal,
): Promise<ConsentReviewResult> {
  if (!spec || !pluginNeedsReview(spec)) return "ok";
  if (spec.consent) return "ok";
  return ensurePackConsent(spec.id, review, signal);
}

export async function ensurePackReviewed(
  spec: PluginView | null,
  review: PackReviewRunner,
  signal?: AbortSignal,
): Promise<boolean> {
  const sig = signal ?? new AbortController().signal;
  const outcome = await ensurePackReviewedOutcome(spec, review, sig);
  return outcome === "ok";
}
