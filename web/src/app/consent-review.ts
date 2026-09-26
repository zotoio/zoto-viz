export type ConsentReviewResult = "ok" | "declined" | "failed" | "aborted";

type PendingEntry = {
  promise: Promise<ConsentReviewResult>;
  abort: () => void;
};

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

/** One in-flight consent dialog per pack id (A→B→A→B shares the same prompt). */
export async function runSharedPackConsent(
  packId: string | null | undefined,
  run: () => Promise<ConsentReviewResult>,
): Promise<ConsentReviewResult> {
  if (!packId) return run();
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

  void run()
    .then((r) => finish(r))
    .catch(() => finish("failed"))
    .finally(() => {
      if (pendingByPackId.get(packId) === entry) pendingByPackId.delete(packId);
    });

  return promise;
}

export function resetSharedPackConsentForTests(): void {
  abortAllOpenPackConsents();
}
