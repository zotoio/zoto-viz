/** Host-passed workBudget caps (set by the monitor before the pack runs). */

import type { ManifestWorkBudget } from "../../../sdk/manifest-work-budget";

export type MarbleWorkBudget = ManifestWorkBudget;

/** Tightest caps before the host passes a clamped manifest budget (never unlimited). */
export const CONSERVATIVE_MARBLE_WORK_BUDGET: ManifestWorkBudget = {
  maxDrawCalls: 0,
  maxTriangles: 0,
  maxInstances: 0,
  maxGpuBytes: 0,
  maxSimStepsPerFrame: 1,
  maxPacketsPerFrame: 0,
};

let cached: MarbleWorkBudget | null = null;

export function setMarbleWorkBudgetFromHost(budget: ManifestWorkBudget): void {
  cached = budget;
}

export function resetMarbleWorkBudgetFromHost(): void {
  cached = null;
}

export function marbleWorkBudget(): MarbleWorkBudget {
  if (!cached) return CONSERVATIVE_MARBLE_WORK_BUDGET;
  return cached;
}
