import {
  clampManifestWorkBudgetAtRuntime,
  type ManifestWorkBudget,
} from "../../../plugins/sdk/manifest-work-budget";

/** Apply host-owned ceilings at runtime (after manifest parse). */
export function hostClampManifestWorkBudget(budget: ManifestWorkBudget): ManifestWorkBudget {
  return clampManifestWorkBudgetAtRuntime(budget);
}
