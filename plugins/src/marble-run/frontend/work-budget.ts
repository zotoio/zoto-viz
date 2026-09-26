/** Host-passed workBudget caps (set by the monitor before the pack runs). */

import type { ManifestWorkBudget } from "../../../sdk/manifest-work-budget";

export type MarbleWorkBudget = ManifestWorkBudget;

let cached: MarbleWorkBudget | null = null;

export function setMarbleWorkBudgetFromHost(budget: MarbleWorkBudget): void {
  cached = budget;
}

export function marbleWorkBudget(): MarbleWorkBudget {
  if (!cached) {
    throw new Error("marble-run workBudget was not set by the host");
  }
  return cached;
}
