import type { ManifestWorkBudget } from "../../../plugins/sdk/manifest-work-budget";
import { hostWorkBudgetCeilings, ingestCatalogWorkBudget } from "./work-budget-policy";
import { clampManifestWorkBudgetToCeilings } from "../../../plugins/sdk/manifest-work-budget";
import type { PluginView } from "./plugin";
import { setMarbleWorkBudgetFromHost } from "../../../plugins/src/marble-run/frontend/work-budget";

/** Apply host-owned ceilings at runtime (after manifest parse). */
export function hostClampManifestWorkBudget(budget: ManifestWorkBudget): ManifestWorkBudget {
  return clampManifestWorkBudgetToCeilings(budget, hostWorkBudgetCeilings());
}

/** Push clamped workBudget from a catalog row into packs that consume it. */
export function applyPluginViewWorkBudget(spec: PluginView): void {
  if (!spec.workBudget) return;
  if (spec.id === "marble-run") {
    setMarbleWorkBudgetFromHost(spec.workBudget);
  }
}
