/**
 * Host workBudget ceilings — fixed path under the install root (never pack-relative).
 */
import hostCeilings from "../../../service/policy/work-budget-ceilings.json";
import { WORK_BUDGET_LIMITED_NOTE } from "../../../plugins/sdk/work-budget-limited-note";
import {
  clampManifestWorkBudgetToCeilings,
  type ManifestWorkBudget,
  MANIFEST_WORK_BUDGET_KEYS,
  parseManifestWorkBudgetShape,
  workBudgetExceedsCeilings,
  workBudgetInstallBlockedReason,
} from "../../../plugins/sdk/manifest-work-budget";

/** Relative to zoto-viz install root (see service/paths.repo_root). */
export const HOST_WORK_BUDGET_CEILINGS_PATH = "service/policy/work-budget-ceilings.json";

export { WORK_BUDGET_LIMITED_NOTE };

let ceilingsCache: ManifestWorkBudget | null = null;
let vitestPolicyOverride: ManifestWorkBudget | null = null;

/** Vitest-only: simulate a lowered host policy without mutating the repo policy file. */
export function setHostWorkBudgetCeilingsForTests(next: ManifestWorkBudget | null): void {
  vitestPolicyOverride = next;
  resetHostWorkBudgetCeilingsCache();
}

export function hostWorkBudgetCeilings(): Readonly<ManifestWorkBudget> {
  if (!ceilingsCache) {
    ceilingsCache =
      vitestPolicyOverride !== null ? vitestPolicyOverride : (hostCeilings as ManifestWorkBudget);
    for (const key of MANIFEST_WORK_BUDGET_KEYS) {
      if (typeof ceilingsCache[key] !== "number") {
        throw new Error(`host policy missing ${key}`);
      }
    }
  }
  return ceilingsCache;
}

export function resetHostWorkBudgetCeilingsCache(): void {
  ceilingsCache = null;
}

export function resolveHostWorkBudgetPolicyPath(_packRoot?: string): string {
  return HOST_WORK_BUDGET_CEILINGS_PATH;
}

export function hostClampManifestWorkBudget(budget: ManifestWorkBudget): ManifestWorkBudget {
  return clampManifestWorkBudgetToCeilings(budget, hostWorkBudgetCeilings());
}

export function ingestCatalogWorkBudget(raw: unknown): {
  budget: ManifestWorkBudget;
  limitedNote?: string;
} {
  const parsed = parseManifestWorkBudgetShape(raw);
  const ceilings = hostWorkBudgetCeilings();
  const budget = hostClampManifestWorkBudget(parsed);
  const limitedNote = workBudgetExceedsCeilings(parsed, ceilings) ? WORK_BUDGET_LIMITED_NOTE : undefined;
  return { budget, limitedNote };
}

export function assertWorkBudgetInstallAllowed(raw: unknown): void {
  const parsed = parseManifestWorkBudgetShape(raw);
  const reason = workBudgetInstallBlockedReason(parsed, hostWorkBudgetCeilings(), 10);
  if (reason) throw new Error(reason);
}

export function assertWorkBudgetOverHostCeiling(raw: unknown): void {
  const parsed = parseManifestWorkBudgetShape(raw);
  const ceilings = hostWorkBudgetCeilings();
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    if (parsed[key] > ceilings[key]) {
      throw new Error(`workBudget.${key} must be at most ${ceilings[key]} (got ${parsed[key]})`);
    }
  }
}
