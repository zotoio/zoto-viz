import type { ManifestWorkBudget } from "../../../sdk/manifest-work-budget";
import { CONSERVATIVE_WORK_BUDGET } from "../../../sdk/host-init-context";

let cached: ManifestWorkBudget | null = null;

export function applyPackWorkBudget(budget: ManifestWorkBudget): void {
  cached = budget;
}

export function resetPackWorkBudget(): void {
  cached = null;
}

export function marbleWorkBudget(): ManifestWorkBudget {
  return cached ?? CONSERVATIVE_WORK_BUDGET;
}

/** @deprecated use CONSERVATIVE_WORK_BUDGET from host-init-context */
export const CONSERVATIVE_MARBLE_WORK_BUDGET = CONSERVATIVE_WORK_BUDGET;
