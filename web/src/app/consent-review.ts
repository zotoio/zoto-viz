export type ConsentReviewResult = "ok" | "declined" | "failed";

const pendingByPackId = new Map<string, Promise<ConsentReviewResult>>();

/** One in-flight consent dialog per pack id (A→B→A→B shares the same prompt). */
export async function runSharedPackConsent(
  packId: string | null | undefined,
  run: () => Promise<ConsentReviewResult>,
): Promise<ConsentReviewResult> {
  if (!packId) return run();
  const existing = pendingByPackId.get(packId);
  if (existing) return existing;
  const pending = run().finally(() => {
    if (pendingByPackId.get(packId) === pending) pendingByPackId.delete(packId);
  });
  pendingByPackId.set(packId, pending);
  return pending;
}

export function resetSharedPackConsentForTests(): void {
  pendingByPackId.clear();
}
